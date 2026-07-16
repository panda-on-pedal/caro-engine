// src/engine/narrow.ts
import {
  findForkPoints,
  findPatterns,
  type ForkPoint,
  type PatternInstance,
  type PatternType,
} from "./patterns.ts";
import { isLegalMove, type Board, type Player } from "./board.ts";
import type { Move } from "./state.ts";
import {
  decayRateForMoveCount,
  distanceWeight,
  sampleWithoutReplacement,
  type DecayConfig,
} from "./randomize.ts";

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

export interface NarrowConfig {
  recognizedForkPatterns: ReadonlySet<ForkPatternName>;
  decay: DecayConfig;
  rng?: () => number;
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

/**
 * Selects a small, tactically relevant set of candidate moves instead of
 * the full raw radius-2 neighborhood, using the pattern catalog that is
 * already computed once per position. See docs/superpowers/specs/
 * 2026-07-17-pattern-driven-search-design.md for the full rationale.
 */
export function narrowCandidates(
  board: Board,
  player: Player,
  moveCount: number,
  config: NarrowConfig,
): Move[] {
  const opponent = otherPlayer(player);
  const ownPatterns = findPatterns(board, player);
  const oppPatterns = findPatterns(board, opponent);

  // Step 1: I can win now.
  const ownFour = ownPatterns.find(
    (p) => p.type === "four" || p.type === "open-four",
  );
  if (ownFour) {
    return ownFour.gains;
  }

  // Step 2: I must block now.
  const oppFour = oppPatterns.find(
    (p) => p.type === "four" || p.type === "open-four",
  );
  if (oppFour) {
    return oppFour.gains;
  }

  // Step 3: tactical set — fork points (offense and defense) and
  // open-three extensions/blocks, deduplicated by cell.
  const tacticalMoves = new Map<string, Move>();

  const addAll = (moves: Move[]) => {
    for (const move of moves) {
      tacticalMoves.set(`${move.row},${move.col}`, move);
    }
  };

  for (const forkPoint of recognizedForkPoints(
    ownPatterns,
    config.recognizedForkPatterns,
  )) {
    tacticalMoves.set(
      `${forkPoint.move.row},${forkPoint.move.col}`,
      forkPoint.move,
    );
  }
  for (const forkPoint of recognizedForkPoints(
    oppPatterns,
    config.recognizedForkPatterns,
  )) {
    tacticalMoves.set(
      `${forkPoint.move.row},${forkPoint.move.col}`,
      forkPoint.move,
    );
  }
  // Use criticalGains, not gains: an open-three's raw `gains` list includes
  // every gap cell from every viable 5-window containing its stones — for
  // a widely-padded three like "..XXX..", that's 4 cells (verified
  // empirically), not just the 2 that actually extend it toward an
  // open-four. criticalGains is exactly "the subset that promotes this
  // line to the next severity tier" (patterns.ts's own definition), which
  // is what a tactical candidate set should mean here.
  for (const pattern of ownPatterns) {
    if (pattern.type === "open-three") {
      addAll(pattern.criticalGains);
    }
  }
  for (const pattern of oppPatterns) {
    if (pattern.type === "open-three") {
      addAll(pattern.criticalGains);
    }
  }

  if (tacticalMoves.size > 0) {
    return weightedReorder(
      board,
      [...tacticalMoves.values()],
      moveCount,
      config,
    );
  }

  // Step 4: quiet fallback — no tactical pattern exists yet (typical in
  // the opening). Sample a small, distance-weighted subset of the raw
  // radius-2 neighborhood instead of returning it all, so quiet positions
  // stay fast and vary between games instead of always resolving to the
  // same deterministic scan-order pick.
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
