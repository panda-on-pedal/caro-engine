// src/engine/narrow.ts
import {
  findForkPoints,
  findPatterns,
  type ForkPoint,
  type PatternInstance,
  type PatternType,
} from "../patterns/patterns.ts";
import { isLegalMove, placeMove, type Board, type Player } from "../board.ts";
import { checkCaroWin } from "../rules.ts";
import type { Move } from "../state.ts";
import {
  decayRateForMoveCount,
  distanceWeight,
  sampleWithoutReplacement,
  type DecayConfig,
} from "../randomize.ts";
import {
  DEFAULT_TOP_K,
  selectTopMoves,
  selectTopMovesFromStore,
  selectTopMovesTiered,
  selectTopMovesTieredFromStore,
} from "./rankMoves.ts";
import type { PatternStore } from "../patterns/patternStore.ts";
import { forkBonusFor } from "./evaluate.ts";

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
        for (let dCol = -CANDIDATE_RADIUS; dCol <= CANDIDATE_RADIUS; dCol += 1) {
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

export type ForkPatternName = "double-three-trap" | "double-four-trap" | "mixed-tier-fork";

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
    matches: forkPoint => forkPoint.patterns.every(p => isTwoTier(p.type)),
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
    matches: forkPoint => forkPoint.patterns.every(p => isThreeTier(p.type)),
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
    matches: forkPoint =>
      forkPoint.patterns.some(p => isTwoTier(p.type)) &&
      forkPoint.patterns.some(p => isThreeTier(p.type)),
  },
];

export const ALL_FORK_PATTERN_NAMES: ReadonlySet<ForkPatternName> = new Set(
  FORK_PATTERNS.map(def => def.name)
);

/**
 * Fork points whose contributing pattern types match at least one
 * recognized catalog entry. Difficulty-gates fork awareness: an easy
 * config with an empty `recognized` set never sees any fork.
 */
export function recognizedForkPoints(
  patterns: readonly PatternInstance[],
  recognized: ReadonlySet<ForkPatternName>
): ForkPoint[] {
  const allForkPoints = findForkPoints(patterns);
  const activeDefs = FORK_PATTERNS.filter(def => recognized.has(def.name));
  return allForkPoints.filter(forkPoint => activeDefs.some(def => def.matches(forkPoint)));
}

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

/**
 * For a "four" pattern with a single completing cell, any equally valid
 * block beyond the run that patterns.ts never surfaces (it only looks at
 * gaps *inside* viable windows). Caro voids a five blocked on both ends,
 * so occupying a far-end "box" now means the eventual five (if the
 * attacker still plays the gain later) never counts as a win.
 *
 * Contiguous four blocked on one end: one box one step beyond the gain.
 * Gapped four (gain fills a hole between stones): far-end boxes beyond
 * the first/last stone — catalog #23's (14,3) beyond (13,4) when the
 * gain sits at (10,7).
 *
 * Returns [] for "open-four" (both ends already open — boxing one side
 * leaves the other fully live, so it doesn't help).
 */
function boxCells(pattern: PatternInstance, board: Board): Move[] {
  if (pattern.type !== "four" || pattern.gains.length !== 1) {
    return [];
  }
  const [dRow, dCol] = pattern.direction;
  const gain = pattern.gains[0];
  const first = pattern.cells[0];
  const last = pattern.cells[pattern.cells.length - 1];

  const legalBox = (row: number, col: number): Move | null =>
    isLegalMove(board, row, col) ? { row, col } : null;

  if (gain.row === first.row - dRow && gain.col === first.col - dCol) {
    const box = legalBox(gain.row - dRow, gain.col - dCol);
    return box ? [box] : [];
  }
  if (gain.row === last.row + dRow && gain.col === last.col + dCol) {
    const box = legalBox(gain.row + dRow, gain.col + dCol);
    return box ? [box] : [];
  }

  const boxes: Move[] = [];
  const beforeFirst = legalBox(first.row - dRow, first.col - dCol);
  const afterLast = legalBox(last.row + dRow, last.col + dCol);
  if (beforeFirst) {
    boxes.push(beforeFirst);
  }
  if (afterLast) {
    boxes.push(afterLast);
  }
  return boxes;
}

/**
 * True when `attacker` can complete a valid Caro five with a single move —
 * i.e. some four/open-four gain passes `checkCaroWin` (which already
 * rejects boxed fives, so a completion whose both ends are blocked does
 * not count).
 */
export function hasImmediateWin(board: Board, attacker: Player): boolean {
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
export function survivingBlocks(
  board: Board,
  defender: Player,
  attacker: Player,
  candidates: Move[]
): Move[] {
  return candidates.filter(
    block => !hasImmediateWin(placeMove(board, block.row, block.col, defender), attacker)
  );
}

/** Tempo ladder for must-answer / race: four beats open-three. */
function threatRank(patterns: readonly PatternInstance[]): number {
  if (patterns.some(p => p.type === "four" || p.type === "open-four")) {
    return 3;
  }
  if (patterns.some(p => p.type === "open-three")) {
    return 2;
  }
  return 0;
}

/**
 * Cells that answer the opponent's current forcing threats: open-three
 * gains only (incl. distance / boxed-five blocks). Empty fork points are
 * not must-answer — ignoring them does not lose next turn; they stay in
 * the urgent pool for ranking so search can still prefer occupying one
 * when offense does not out-tempo it (catalog #10). Catalog #18: a two-
 * open-three counter must not be stripped just because a two-tier fork
 * cell exists.
 */
function forcingAnswerKeys(oppPatterns: readonly PatternInstance[]): Set<string> {
  const keys = new Set<string>();
  for (const pattern of oppPatterns) {
    if (pattern.type !== "open-three") {
      continue;
    }
    for (const gain of pattern.gains) {
      keys.add(`${gain.row},${gain.col}`);
    }
  }
  return keys;
}

/** Already holding open-three / four means the whole urgent pool may race. */
function ownAlreadyRacing(ownPatterns: readonly PatternInstance[]): boolean {
  return threatRank(ownPatterns) >= 2;
}

/**
 * True when the opponent holds an open-three — a threat that converts to an
 * open four, and so to a win, in a single move. (A four would already have
 * returned at step 2 or switched on desperado.) The urgent tier plus the
 * must-answer filter are what handle these; a slower shape must not
 * short-circuit ahead of them.
 */
function opponentThreatensSooner(oppPatterns: readonly PatternInstance[]): boolean {
  return threatRank(oppPatterns) >= 2;
}

/**
 * True when playing `move` as `player` promotes a line into a four /
 * open-four. That is the only tempo that forces the opponent to answer
 * instead of converting their own threat — merely creating an open-three
 * does not race (catalog #11's 8,6).
 */
function createsFour(
  board: Board,
  player: Player,
  move: Move,
  store: PatternStore | undefined
): boolean {
  if (!isLegalMove(board, move.row, move.col)) {
    return false;
  }
  if (store !== undefined) {
    store.place(move, player);
    const rank = threatRank(store.patterns(player));
    store.undo();
    return rank >= 3;
  }
  const next = placeMove(board, move.row, move.col, player);
  return threatRank(findPatterns(next, player)) >= 3;
}

/**
 * Opponent patterns as they would stand after `opponent` plays `move`,
 * via the pattern store's place/undo when one is available (this runs per
 * three gain at every node; a full-board rescan here is not affordable).
 */
function opponentPatternsAfter(
  board: Board,
  opponent: Player,
  move: Move,
  store: PatternStore | undefined
): readonly PatternInstance[] {
  if (store === undefined) {
    return findPatterns(placeMove(board, move.row, move.col, opponent), opponent);
  }
  store.place(move, opponent);
  // Safe past the undo: the store swaps its pattern arrays by reference
  // rather than mutating them.
  const patterns = store.patterns(opponent);
  store.undo();
  return patterns;
}

function promotesToOpenThree(pattern: PatternInstance, move: Move): boolean {
  if (pattern.type !== "open-two") {
    return false;
  }
  return pattern.criticalGains.some(gain => gain.row === move.row && gain.col === move.col);
}

interface ThreeLine {
  /** Identifies the line across boards that differ only outside it, so the
   * same three found before and after an expansion compares equal. */
  key: string;
  gains: readonly Move[];
}

function toThreeLine(pattern: PatternInstance): ThreeLine {
  return {
    key: pattern.cells.map(cell => `${cell.row},${cell.col}`).join("|"),
    gains: pattern.gains,
  };
}

/**
 * One way for the opponent to reach an unstoppable double threat: expand a
 * three into a four (forcing us to answer), then play a fork cell that
 * makes an open-three and another four at once. A route always runs over
 * two lines — the expanded three and the fork's four half — and dies if
 * either of them does, so those are what it lists.
 */
type ForkRoute = readonly ThreeLine[];

/**
 * The routes that open up when `three` expands into a four.
 *
 * A fork qualifies only if playing it would create an OPEN-three alongside
 * the four, since playing a gain promotes each of the fork's lines one
 * tier: a three-tier line becomes the four, an open-two becomes the
 * open-three — the latter only on a critical gain, so a two whose promotion
 * arrives boxed does not count. The three such a two yields is answerable,
 * and the shape is then not worth forcing the candidate pool over.
 */
function forkRoutesFromExpanding(
  board: Board,
  opponent: Player,
  three: PatternInstance,
  config: NarrowConfig
): ForkRoute[] {
  const routes: ForkRoute[] = [];

  for (const gain of three.gains) {
    if (!isLegalMove(board, gain.row, gain.col)) {
      continue;
    }
    const expanded = opponentPatternsAfter(board, opponent, gain, config.store);
    if (threatRank(expanded) < 3) {
      continue;
    }
    for (const forkPoint of recognizedForkPoints(expanded, config.recognizedForkPatterns)) {
      if (!forkPoint.patterns.some(pattern => promotesToOpenThree(pattern, forkPoint.move))) {
        continue;
      }
      const fourHalves = forkPoint.patterns.filter(pattern => isThreeTier(pattern.type));
      if (fourHalves.length === 0) {
        continue;
      }
      routes.push([toThreeLine(three), ...fourHalves.map(toThreeLine)]);
    }
  }

  return routes;
}

/**
 * Lines carrying every route — the only ones a single move can kill to
 * defuse all of them at once. Empty when the routes have no line in common,
 * which means no block answers them all.
 */
function linesCarryingEveryRoute(routes: readonly ForkRoute[]): ThreeLine[] {
  const [first, ...rest] = routes;
  return first.filter(line => rest.every(route => route.some(other => other.key === line.key)));
}

interface ForcedExpansionParams {
  board: Board;
  player: Player;
  opponent: Player;
  ownPatterns: readonly PatternInstance[];
  oppPatterns: readonly PatternInstance[];
  config: NarrowConfig;
}

/**
 * Answers to an opponent three whose own expansion sets up a win: playing
 * one of its gains makes a four (which we are then obliged to answer) and
 * the position it leaves behind holds a fork cell worth an open-three plus
 * a four, so our forced reply just buys the tempo that lands it. Catalog
 * #21 is the shape — O's row-8 three expands toward 9,4-8,5-6,7 +
 * 6,7-7,7-8,7-9,7 and every X move except the ones below loses.
 *
 * The threat is verified by simulation rather than inferred from today's
 * pattern tiers: the gain is actually played and the resulting fork is
 * looked for on that board. Tier inspection alone over-fires — most
 * three-tier fork cells trivially "make a four", which made this tier
 * return `forced` for positions that were nowhere near lost (catalog #22).
 *
 * A three is only worth blocking if it carries EVERY route found, since a
 * block on a line the opponent can simply route around is not an answer at
 * all. Catalog #21 has four routes over three threes — row 8, column 7 and
 * the 7,7-9,9 diagonal, pairwise — and row 8 is in all four, so 8,5 / 8,6
 * answer while the diagonal's 5,5 / 6,6 (which leave the row 8 + column 7
 * route untouched) do not. Our own three gains that make a four join them
 * so offense can still out-tempo the threat instead of only defending
 * (catalog #21: 12,5 and 13,4).
 *
 * PRECONDITION: the opponent holds nothing faster. This pool is returned
 * exclusively, and the threat it defends is still two moves from landing,
 * so calling it while the opponent has a one-move threat prunes the answer
 * to that threat out of the search (catalog #22).
 *
 * Returns an empty list when no three expands this way, and also when no
 * single line carries every route — both leave the caller on the normal
 * tactical tiers, which is where a position with no one answer belongs.
 */
function forcedMovesAfterOpExpandTheirThree({
  board,
  player,
  opponent,
  ownPatterns,
  oppPatterns,
  config,
}: ForcedExpansionParams): Move[] {
  const routes = oppPatterns
    .filter(pattern => isThreeTier(pattern.type))
    .flatMap(three => forkRoutesFromExpanding(board, opponent, three, config));
  if (routes.length === 0) {
    return [];
  }

  const shared = linesCarryingEveryRoute(routes);
  if (shared.length === 0) {
    return [];
  }

  const answers = new Map<string, Move>();
  for (const line of shared) {
    for (const gain of line.gains) {
      answers.set(`${gain.row},${gain.col}`, gain);
    }
  }

  for (const pattern of ownPatterns) {
    if (!isThreeTier(pattern.type)) {
      continue;
    }
    for (const gain of pattern.gains) {
      if (createsFour(board, player, gain, config.store)) {
        answers.set(`${gain.row},${gain.col}`, gain);
      }
    }
  }

  return [...answers.values()];
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
  /** When set, skip the opening `findPatterns` scans. */
  ownPatterns?: readonly PatternInstance[];
  oppPatterns?: readonly PatternInstance[];
  /** When set, top-K scoring uses store place/undo instead of full rescans. */
  store?: PatternStore;
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
  config: NarrowConfig
): Move[] {
  if (moves.length <= 1) {
    return moves;
  }
  const decayRate = decayRateForMoveCount(moveCount, config.decay);
  const weights = moves.map(move => distanceWeight(nearestStoneDistance(board, move), decayRate));
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
 * own open-two into an open-three, ~+240 on rank weights) routinely exceeds
 * an urgent block's (downgrading the opponent's open-three, ~+225) even when the
 * block is the only move that avoids losing. Within each tier, moves sort
 * by `scoreMove` (own pattern-score gain + opponent pattern-score loss)
 * descending, so branching stays near-constant at every search node and a
 * dual-purpose move deterministically outranks a single-purpose one.
 */
export function narrowCandidates(
  board: Board,
  player: Player,
  moveCount: number,
  config: NarrowConfig
): NarrowResult {
  const opponent = otherPlayer(player);
  const ownPatterns = config.ownPatterns ?? findPatterns(board, player);
  const oppPatterns = config.oppPatterns ?? findPatterns(board, opponent);

  // Step 1: I can win now.
  const ownFour = ownPatterns.find(p => p.type === "four" || p.type === "open-four");
  if (ownFour) {
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
  const oppFour = oppPatterns.find(p => p.type === "four" || p.type === "open-four");
  if (oppFour) {
    const candidateMap = new Map<string, Move>();
    for (const move of [...oppFour.gains, ...boxCells(oppFour, board)]) {
      candidateMap.set(`${move.row},${move.col}`, move);
    }
    const candidates = [...candidateMap.values()];
    if (!desperadoEnabled) {
      return { moves: candidates, source: "forced" };
    }
    const working = survivingBlocks(board, player, opponent, candidates);
    if (working.length > 0) {
      return { moves: working, source: "forced" };
    }
    desperadoBlocks = candidates;
  }

  // Step 2b: I must answer a three whose expansion into a four sets up an
  // unstoppable fork. Skipped in desperado (defense is pointless once the
  // opponent's four is unstoppable), when we already hold an open-three /
  // four, since then the full urgent pool can race instead of being pinned
  // to the answers, and when the opponent has an open-three — that lands a
  // move sooner, so answering it comes first. The last one is what keeps
  // this tier sound: the pool below is returned exclusively and holds only
  // the lines shared by every fork route, so an open-three sitting outside
  // those lines would have its block pruned away (catalog #22).
  if (
    desperadoBlocks === null &&
    !ownAlreadyRacing(ownPatterns) &&
    !opponentThreatensSooner(oppPatterns)
  ) {
    const expansionAnswers = forcedMovesAfterOpExpandTheirThree({
      board,
      player,
      opponent,
      ownPatterns,
      oppPatterns,
      config,
    });
    if (expansionAnswers.length > 0) {
      return { moves: expansionAnswers, source: "forced" };
    }
  }

  const urgentMoves = new Map<string, Move>();
  const softMoves = new Map<string, Move>();
  // Recognized fork points get a static score bonus on top of guaranteed
  // tier-1 inclusion: a move that advances two separate lines at once
  // should outrank a comparably-scored single-line move within the same
  // tier, both for move-ordering (search sees the more promising branch
  // first) and so a fork doesn't quietly lose the tie-break to whatever
  // else is sitting in the pool. It's a nudge, not an override — a real
  // four/open-four completion still scores far higher on raw pattern
  // severity, and it's still search's job to confirm the fork actually
  // works (see catalog #13's mirage note above).
  const forkBonus = new Map<string, number>();

  const addTo = (target: Map<string, Move>, moves: Move[]) => {
    for (const move of moves) {
      target.set(`${move.row},${move.col}`, move);
    }
  };

  for (const forkPoint of recognizedForkPoints(ownPatterns, config.recognizedForkPatterns)) {
    const key = `${forkPoint.move.row},${forkPoint.move.col}`;
    urgentMoves.set(key, forkPoint.move);
    forkBonus.set(key, forkBonusFor(forkPoint));
  }
  // Desperado (opponent's four is unstoppable): defense of any kind is
  // pointless, and negamax's -(WIN_SCORE + depth) loss scoring means a
  // delaying block in the pool would always beat offense in search — so
  // collect the player's OWN threats exclusively. Opponent-derived
  // candidates (fork blocks, three/two answers) and quiet padding are
  // all skipped.
  const desperado = desperadoBlocks !== null;

  if (!desperado) {
    for (const forkPoint of recognizedForkPoints(oppPatterns, config.recognizedForkPatterns)) {
      const key = `${forkPoint.move.row},${forkPoint.move.col}`;
      urgentMoves.set(key, forkPoint.move);
      forkBonus.set(key, forkBonusFor(forkPoint));
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
    // Must-answer forcing threats: opponent open-three and/or recognized
    // forks, when we do not already hold an open-three/four. Survivors =
    // answer cells ∪ moves that create a racing four/open-four (catalog
    // #16 keeps 8,10; catalog #11 still drops 8,6 which only makes
    // open-threes). Skipped in desperado mode.
    const answerKeys = forcingAnswerKeys(oppPatterns);
    const mustAnswer = !desperado && answerKeys.size > 0 && !ownAlreadyRacing(ownPatterns);

    // Neither tier is forced — fill remaining slots from the quiet
    // neighborhood so development/racing stays possible, but cap at the
    // quiet sample size so every-node branching does not explode. Quiet
    // fillers join the soft tier: they compete with soft gains on score,
    // but neither can displace an urgent threat-answering move —
    // selectTopMovesTiered guarantees the urgent tier survives top-K
    // ahead of any soft/quiet score. Skip quiet padding when we must
    // answer (those fillers would be stripped anyway).
    const softAndQuiet = new Map(softMoves);
    let poolSize = new Set([...urgentMoves.keys(), ...softAndQuiet.keys()]).size;
    if (!desperado && !mustAnswer && poolSize < QUIET_FALLBACK_SAMPLE_SIZE) {
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

    const urgentCandidates = [...urgentMoves.values()];
    const softCandidates = [...softAndQuiet.values()];
    let urgentSurvivors = urgentCandidates;
    let softSurvivors = softCandidates;
    if (mustAnswer) {
      const survives = (move: Move) => {
        const key = `${move.row},${move.col}`;
        if (answerKeys.has(key)) {
          return true;
        }
        return createsFour(board, player, move, config.store);
      };
      urgentSurvivors = urgentCandidates.filter(survives);
      softSurvivors = softCandidates.filter(survives);
      // Safety: never hand search an empty pool if gains were empty or
      // mistyped — fall back to the unfiltered set.
      if (urgentSurvivors.length + softSurvivors.length === 0) {
        urgentSurvivors = urgentCandidates;
        softSurvivors = softCandidates;
      }
    }

    const selectedMoves = config.store
      ? selectTopMovesTieredFromStore(
          config.store,
          player,
          [urgentSurvivors, softSurvivors],
          DEFAULT_TOP_K,
          forkBonus
        )
      : selectTopMovesTiered(
          board,
          player,
          [urgentSurvivors, softSurvivors],
          DEFAULT_TOP_K,
          forkBonus
        );

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

  const quietSample = sampleQuietMoves(board, moveCount, config);
  return {
    moves: config.store
      ? selectTopMovesFromStore(config.store, player, quietSample, DEFAULT_TOP_K)
      : selectTopMoves(board, player, quietSample, DEFAULT_TOP_K),
    source: "quiet",
  };
}

/** Distance-weighted quiet sample from the raw radius-2 neighborhood. */
function sampleQuietMoves(board: Board, moveCount: number, config: NarrowConfig): Move[] {
  const raw = findCandidateMoves(board);
  if (raw.length <= QUIET_FALLBACK_SAMPLE_SIZE) {
    return weightedReorder(board, raw, moveCount, config);
  }

  const decayRate = decayRateForMoveCount(moveCount, config.decay);
  const weights = raw.map(move => distanceWeight(nearestStoneDistance(board, move), decayRate));
  return sampleWithoutReplacement(raw, weights, QUIET_FALLBACK_SAMPLE_SIZE, config.rng);
}
