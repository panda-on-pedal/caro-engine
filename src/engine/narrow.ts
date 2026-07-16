// src/engine/narrow.ts
import {
  findForkPoints,
  type ForkPoint,
  type PatternInstance,
  type PatternType,
} from "./patterns.ts";

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
