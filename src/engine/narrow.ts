// src/engine/narrow.ts
import {
  findForkPoints,
  findPatterns,
  type ForkPoint,
  type PatternInstance,
  type PatternType,
} from "./patterns.ts";
import type { Board, Player } from "./board.ts";
import type { Move } from "./state.ts";
import type { DecayConfig } from "./randomize.ts";

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
    return [...tacticalMoves.values()];
  }

  return [];
}
