// src/engine/narrow.ts
import {
  findForkPoints,
  findPatterns,
  type ForkPoint,
  type PatternInstance,
  type PatternType,
} from "./patterns.ts";
import {
  isLegalMove,
  placeMove,
  type Board,
  type Player,
} from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import type { Move } from "./state.ts";
import {
  decayRateForMoveCount,
  distanceWeight,
  sampleWithoutReplacement,
  type DecayConfig,
} from "./randomize.ts";
import {
  DEFAULT_TOP_K,
  selectTopMoves,
  selectTopMovesTiered,
} from "./rankMoves.ts";

const CANDIDATE_RADIUS = 2;

export function findCandidateMoves(board: Board): Move[] {
  const candidates = new Map<string, Move>();
  let hasStone = false;

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] === 0) {
        continue;
      }
      hasStone = true;
      for (let dRow = -CANDIDATE_RADIUS; dRow <= CANDIDATE_RADIUS; dRow += 1) {
        for (
          let dCol = -CANDIDATE_RADIUS;
          dCol <= CANDIDATE_RADIUS;
          dCol += 1
        ) {
          const r = row + dRow;
          const c = col + dCol;
          if (isLegalMove(board, r, c)) {
            candidates.set(`${r},${c}`, { row: r, col: c });
          }
        }
      }
    }
  }

  if (!hasStone) {
    const center = Math.floor(board.length / 2);
    return [{ row: center, col: center }];
  }

  return [...candidates.values()];
}

export type ForkPatternName =
  | "double-three-trap"
  | "double-four-trap"
  | "mixed-tier-fork";

export interface ForkPatternDef {
  name: ForkPatternName;
  /** ASCII diagram, for documentation and as the source of the test
   * fixtures above — matching is functional, this is specification only. */
  example: string;
  matches: (forkPoint: ForkPoint) => boolean;
}

function isTwoTier(type: PatternType): boolean {
  return type === "two" || type === "open-two";
}

function isThreeTier(type: PatternType): boolean {
  return type === "three" || type === "open-three";
}

export const FORK_PATTERNS: readonly ForkPatternDef[] = [
  {
    name: "double-three-trap",
    example: `
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `,
    matches: (forkPoint) =>
      forkPoint.patterns.every((p) => isTwoTier(p.type)),
  },
  {
    name: "double-four-trap",
    example: `
      ........
      .....X..
      .....X..
      .....X..
      ..XXX...
      ........
    `,
    matches: (forkPoint) =>
      forkPoint.patterns.every((p) => isThreeTier(p.type)),
  },
  {
    name: "mixed-tier-fork",
    example: `
      .......
      .....X.
      ..XXX..
      .....X.
      .......
      .......
      .......
    `,
    // Deliberately never matches a four/open-four combination: those are
    // always intercepted by narrowCandidates' step 1/2 forced win/block
    // short-circuit (Task 4) before fork detection (step 3) ever runs, so
    // a four-involving fork shape would be dead code here. This entry
    // exists for the two lower tiers only.
    matches: (forkPoint) =>
      forkPoint.patterns.some((p) => isTwoTier(p.type)) &&
      forkPoint.patterns.some((p) => isThreeTier(p.type)),
  },
];

export const ALL_FORK_PATTERN_NAMES: ReadonlySet<ForkPatternName> = new Set(
  FORK_PATTERNS.map((def) => def.name),
);

/**
 * Fork points whose contributing pattern types match at least one
 * recognized catalog entry. Difficulty-gates fork awareness: an easy
 * config with an empty `recognized` set never sees any fork.
 */
export function recognizedForkPoints(
  patterns: PatternInstance[],
  recognized: ReadonlySet<ForkPatternName>,
): ForkPoint[] {
  const allForkPoints = findForkPoints(patterns);
  const activeDefs = FORK_PATTERNS.filter((def) => recognized.has(def.name));
  return allForkPoints.filter((forkPoint) =>
    activeDefs.some((def) => def.matches(forkPoint)),
  );
}

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

/**
 * For a "four" pattern blocked on one end (a single gain completes it),
 * the cell one step *beyond* that gain — continuing the same run
 * direction — is an equally valid block: Caro voids a five blocked on
 * both ends, so occupying this "box" cell now means the eventual five
 * (if the attacker still plays the gain later) never counts as a win.
 * patterns.ts's own gain-scanning never surfaces this cell (it only
 * looks at gaps *inside* viable windows, and this cell sits just
 * outside the pattern's stones), so it has to be computed here.
 * Returns null for "open-four" (both ends already open — boxing one
 * side leaves the other fully live, so it doesn't help) or when the
 * box cell is off-board/already occupied.
 */
function boxCell(pattern: PatternInstance, board: Board): Move | null {
  if (pattern.type !== "four" || pattern.gains.length !== 1) {
    return null;
  }
  const [dRow, dCol] = pattern.direction;
  const gain = pattern.gains[0];
  const first = pattern.cells[0];
  const last = pattern.cells[pattern.cells.length - 1];

  let box: Move;
  if (gain.row === first.row - dRow && gain.col === first.col - dCol) {
    box = { row: gain.row - dRow, col: gain.col - dCol };
  } else if (gain.row === last.row + dRow && gain.col === last.col + dCol) {
    box = { row: gain.row + dRow, col: gain.col + dCol };
  } else {
    return null;
  }
  return isLegalMove(board, box.row, box.col) ? box : null;
}

/**
 * True when `attacker` can complete a valid Caro five with a single move —
 * i.e. some four/open-four gain passes `checkCaroWin` (which already
 * rejects boxed fives, so a completion whose both ends are blocked does
 * not count).
 */
function hasImmediateWin(board: Board, attacker: Player): boolean {
  for (const pattern of findPatterns(board, attacker)) {
    if (pattern.type !== "four" && pattern.type !== "open-four") {
      continue;
    }
    for (const gain of pattern.gains) {
      const next = placeMove(board, gain.row, gain.col, attacker);
      if (checkCaroWin(next, gain.row, gain.col, attacker)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Futility filter for the forced block tier: a candidate block only
 * counts if, after playing it, the attacker no longer has an immediate
 * winning completion. Blocking one end of a true open four provably
 * fails (the other completion is a five blocked on at most one end,
 * which Caro accepts), while a block that boxes or takes the only live
 * gain survives. Type inspection alone can't decide this — an open four
 * IS stoppable when an outer cell is already blocked (boxed five, e.g.
 * catalog #6) — so each candidate is simulated.
 */
function survivingBlocks(
  board: Board,
  defender: Player,
  attacker: Player,
  candidates: Move[],
): Move[] {
  return candidates.filter(
    (block) =>
      !hasImmediateWin(
        placeMove(board, block.row, block.col, defender),
        attacker,
      ),
  );
}

export interface NarrowConfig {
  recognizedForkPatterns: ReadonlySet<ForkPatternName>;
  decay: DecayConfig;
  rng?: () => number;
  /**
   * When true (default), a block against the opponent's four/open-four is
   * only forced if it actually survives (see `survivingBlocks`); a
   * provably futile block (a true open four) switches Step 2 to an
   * offense-only candidate set instead of forcing a move that loses
   * anyway. When false, restores the pre-desperado behavior: the
   * opponent's four/open-four gains (plus the boxed-five cell) are always
   * forced, futile or not. Exposed as a toggle for comparing the two
   * behaviors side by side.
   */
  desperado?: boolean;
}

const QUIET_FALLBACK_SAMPLE_SIZE = 8;

function chebyshevDistance(a: Move, b: Move): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

function nearestStoneDistance(board: Board, move: Move): number {
  let nearest = Infinity;
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] === 0) {
        continue;
      }
      const distance = chebyshevDistance(move, { row, col });
      if (distance < nearest) {
        nearest = distance;
      }
    }
  }
  return nearest;
}

/** Reorders `moves` via the same weighted-random mechanism used for the
 * quiet fallback (a full shuffle, since count === moves.length), so a
 * downstream consumer that takes "the first candidate" (patternOnlyStrategy)
 * sees variety instead of a fixed Map-insertion-order pick when multiple
 * moves tie for the same tactical priority. */
function weightedReorder(
  board: Board,
  moves: Move[],
  moveCount: number,
  config: NarrowConfig,
): Move[] {
  if (moves.length <= 1) {
    return moves;
  }
  const decayRate = decayRateForMoveCount(moveCount, config.decay);
  const weights = moves.map((move) =>
    distanceWeight(nearestStoneDistance(board, move), decayRate),
  );
  return sampleWithoutReplacement(moves, weights, moves.length, config.rng);
}

export type NarrowSource = "forced" | "tactical" | "quiet";

export type NarrowResult = {
  moves: Move[];
  source: NarrowSource;
};

/**
 * Selects a small, tactically relevant set of candidate moves instead of
 * the full raw radius-2 neighborhood, using the pattern catalog that is
 * already computed once per position. See docs/superpowers/specs/
 * 2026-07-17-pattern-driven-search-design.md for the full rationale.
 *
 * Urgency tiers (exclusive forced; urgent+soft always merged):
 * 1. Forced — own/opp four / open-four gains only. Exempt from top-K:
 *    typically 1-2 gains already, and short-circuits before scoring.
 * 2. Urgent ∪ soft — recognized forks, open-three criticalGains, three
 *    gains, and open-two criticalGains (own + opp), merged with a quiet
 *    sample when the merged set is small. Urgent (three-tier) threats are
 *    NOT returned exclusively: a one-sided three is real but not fully
 *    forced, so a strong counter-attack elsewhere must be able to compete
 *    on score rather than being filtered out before scoring ever runs
 *    (see docs/superpowers/plans/2026-07-18-board-state-catalog.md #2,
 *    where blocking a one-sided three lost to a move that both built an
 *    open-three and cut the opponent's other line).
 * 3. Quiet — distance-weighted radius-2 sample when nothing else applies.
 *
 * The tactical pool is selected tier-first via `selectTopMovesTiered`:
 * urgent moves (fork points, three/open-three answers) always precede —
 * and can never be crowded out of the top `DEFAULT_TOP_K` by — soft gains
 * and quiet fillers, because a soft move's static score (e.g. growing an
 * own open-two into an open-three, ~+4900) routinely exceeds an urgent
 * block's (downgrading the opponent's open-three, ~+4500) even when the
 * block is the only move that avoids losing. Within each tier, moves sort
 * by `scoreMove` (own pattern-score gain + opponent pattern-score loss)
 * descending, so branching stays near-constant at every search node and a
 * dual-purpose move deterministically outranks a single-purpose one.
 */
export function narrowCandidates(
  board: Board,
  player: Player,
  moveCount: number,
  config: NarrowConfig,
): NarrowResult {
  const opponent = otherPlayer(player);
  const ownPatterns = findPatterns(board, player);
  const oppPatterns = findPatterns(board, opponent);

  // Step 1: I can win now.
  const ownFour = ownPatterns.find(
    (p) => p.type === "four" || p.type === "open-four",
  );
  if (ownFour) {
    console.log('OWN FOUR', ownFour);
    return { moves: ownFour.gains, source: "forced" };
  }

  // Step 2: I must block now — but only if a block actually works.
  // When no candidate survives the futility check (a true open four:
  // every block still loses to the other completion), the position is
  // lost against perfect play, so don't force a futile block. Fall
  // through to the tactical tiers with the blocks kept as urgent backup:
  // scoring then ranks an own four-maker (+~95000) above a futile block
  // (+~90000) and a futile block above weaker offense — "maximize one
  // opponent miss": advance when that converts a missed win into an own
  // win, block when survival is the best a miss can buy.
  const desperadoEnabled = config.desperado ?? true;
  let desperadoBlocks: Move[] | null = null;
  const oppFour = oppPatterns.find(
    (p) => p.type === "four" || p.type === "open-four",
  );
  if (oppFour) {
    const box = boxCell(oppFour, board);
    const candidates = box ? [...oppFour.gains, box] : oppFour.gains;
    if (!desperadoEnabled) {
      return { moves: candidates, source: "forced" };
    }
    const working = survivingBlocks(board, player, opponent, candidates);
    console.log('OPP FOUR', {
      oppFour,
      box,
      working,
    });
    if (working.length > 0) {
      return { moves: working, source: "forced" };
    }
    desperadoBlocks = candidates;
  }

  const urgentMoves = new Map<string, Move>();
  const softMoves = new Map<string, Move>();

  const addTo = (target: Map<string, Move>, moves: Move[]) => {
    for (const move of moves) {
      target.set(`${move.row},${move.col}`, move);
    }
  };

  for (const forkPoint of recognizedForkPoints(
    ownPatterns,
    config.recognizedForkPatterns,
  )) {
    urgentMoves.set(
      `${forkPoint.move.row},${forkPoint.move.col}`,
      forkPoint.move,
    );
  }
  // Desperado (opponent's four is unstoppable): defense of any kind is
  // pointless, and negamax's -(WIN_SCORE + depth) loss scoring means a
  // delaying block in the pool would always beat offense in search — so
  // collect the player's OWN threats exclusively. Opponent-derived
  // candidates (fork blocks, three/two answers) and quiet padding are
  // all skipped.
  const desperado = desperadoBlocks !== null;

  if (!desperado) {
    for (const forkPoint of recognizedForkPoints(
      oppPatterns,
      config.recognizedForkPatterns,
    )) {
      urgentMoves.set(
        `${forkPoint.move.row},${forkPoint.move.col}`,
        forkPoint.move,
      );
    }
  }

  // Open variants (both ends viable): criticalGains only (raw gains
  // over-include padded gaps). Blocked variants (one end already closed):
  // all gains — expand/block toward the next tier (XOOO.., X.OOO., …;
  // XOO.. for the two-tier equivalent). In desperado mode the open-three
  // keeps its FULL gains: a plain four is still a forcing threat, and
  // forcing threats are all a lost position has left.
  for (const pattern of ownPatterns) {
    if (pattern.type === "open-three") {
      addTo(urgentMoves, desperado ? pattern.gains : pattern.criticalGains);
    } else if (pattern.type === "three") {
      addTo(urgentMoves, pattern.gains);
    } else if (pattern.type === "open-two") {
      addTo(softMoves, pattern.criticalGains);
    } else if (pattern.type === "two") {
      addTo(softMoves, pattern.gains);
    }
  }
  // Defense reads the opponent's open-threes differently from offense:
  // every gain — not just the criticalGains that would promote to an
  // open-four — is a viable block. The one-step-beyond cells (gaps of the
  // outermost completion windows) neutralize the line via Caro's
  // boxed-five rule even though they leave the direct extension open.
  if (!desperado) {
    for (const pattern of oppPatterns) {
      if (pattern.type === "open-three") {
        addTo(urgentMoves, pattern.gains);
      } else if (pattern.type === "three") {
        addTo(urgentMoves, pattern.gains);
      } else if (pattern.type === "open-two") {
        addTo(softMoves, pattern.criticalGains);
      } else if (pattern.type === "two") {
        addTo(softMoves, pattern.gains);
      }
    }
  }

  if (urgentMoves.size > 0 || softMoves.size > 0) {
    // Neither tier is forced — fill remaining slots from the quiet
    // neighborhood so development/racing stays possible, but cap at the
    // quiet sample size so every-node branching does not explode. Quiet
    // fillers join the soft tier: they compete with soft gains on score,
    // but neither can displace an urgent threat-answering move —
    // selectTopMovesTiered guarantees the urgent tier survives top-K
    // ahead of any soft/quiet score.
    const softAndQuiet = new Map(softMoves);
    let poolSize = new Set([...urgentMoves.keys(), ...softAndQuiet.keys()])
      .size;
    if (!desperado && poolSize < QUIET_FALLBACK_SAMPLE_SIZE) {
      for (const move of sampleQuietMoves(board, moveCount, config)) {
        if (poolSize >= QUIET_FALLBACK_SAMPLE_SIZE) {
          break;
        }
        const key = `${move.row},${move.col}`;
        if (!urgentMoves.has(key) && !softAndQuiet.has(key)) {
          softAndQuiet.set(key, move);
          poolSize += 1;
        }
      }
    }
    const selectedMoves = selectTopMovesTiered(
      board,
      player,
      [[...urgentMoves.values()], [...softAndQuiet.values()]],
      DEFAULT_TOP_K,
    );

    console.log('MOVES', {
      selectedMoves,
      urgentMoves,
      softMoves: softAndQuiet,
    });

    return {
      moves: selectedMoves,
      source: "tactical",
    };
  }

  // Desperado with no own threats at all: nothing to attack with, so
  // block anyway (and hope the opponent misses the win) rather than
  // playing a random quiet move.
  if (desperadoBlocks) {
    return { moves: desperadoBlocks, source: "forced" };
  }

  return {
    moves: selectTopMoves(
      board,
      player,
      sampleQuietMoves(board, moveCount, config),
      DEFAULT_TOP_K,
    ),
    source: "quiet",
  };
}

/** Distance-weighted quiet sample from the raw radius-2 neighborhood. */
function sampleQuietMoves(
  board: Board,
  moveCount: number,
  config: NarrowConfig,
): Move[] {
  const raw = findCandidateMoves(board);
  if (raw.length <= QUIET_FALLBACK_SAMPLE_SIZE) {
    return weightedReorder(board, raw, moveCount, config);
  }

  const decayRate = decayRateForMoveCount(moveCount, config.decay);
  const weights = raw.map((move) =>
    distanceWeight(nearestStoneDistance(board, move), decayRate),
  );
  return sampleWithoutReplacement(
    raw,
    weights,
    QUIET_FALLBACK_SAMPLE_SIZE,
    config.rng,
  );
}
