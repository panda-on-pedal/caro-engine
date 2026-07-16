// src/engine/narrow.spec.ts
import { findForkPoints, findPatterns } from "./patterns.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  FORK_PATTERNS,
  recognizedForkPoints,
} from "./narrow.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

describe("FORK_PATTERNS catalog", () => {
  it("double-three-trap matches a fork point made of two two-tier patterns", () => {
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    expect(forkPoints).toHaveLength(1);
    const def = FORK_PATTERNS.find((d) => d.name === "double-three-trap")!;
    expect(def.matches(forkPoints[0])).toBe(true);
  });

  it("double-three-trap does not match a fork point made of two three-tier patterns", () => {
    const board = parseBoard(`
      ........
      .....X..
      .....X..
      .....X..
      ..XXX...
      ........
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    expect(forkPoints).toHaveLength(1);
    const def = FORK_PATTERNS.find((d) => d.name === "double-three-trap")!;
    expect(def.matches(forkPoints[0])).toBe(false);
  });

  it("double-four-trap matches a fork point made of two three-tier patterns", () => {
    const board = parseBoard(`
      ........
      .....X..
      .....X..
      .....X..
      ..XXX...
      ........
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    const def = FORK_PATTERNS.find((d) => d.name === "double-four-trap")!;
    expect(def.matches(forkPoints[0])).toBe(true);
  });

  it("mixed-tier-fork matches a fork point combining a three-tier and a two-tier pattern", () => {
    // Horizontal open-three at row 2 (cols 2-4); vertical open-two at col 5
    // (rows 1 and 3, split by the gap at row 2 that both lines converge on).
    // A four/open-four is deliberately never part of this catalog entry:
    // narrowCandidates' step 1/2 (Task 4) always short-circuits on any
    // four/open-four before step 3's fork detection ever runs, so a
    // "four+three" fork shape would be unreachable in practice — this
    // catalog entry exists specifically for the two lower tiers.
    const board = parseBoard(`
      .......
      .....X.
      ..XXX..
      .....X.
      .......
      .......
      .......
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    expect(forkPoints).toHaveLength(1);
    const def = FORK_PATTERNS.find((d) => d.name === "mixed-tier-fork")!;
    expect(def.matches(forkPoints[0])).toBe(true);
    const doubleThreeDef = FORK_PATTERNS.find(
      (d) => d.name === "double-three-trap",
    )!;
    expect(doubleThreeDef.matches(forkPoints[0])).toBe(false);
    const doubleFourDef = FORK_PATTERNS.find(
      (d) => d.name === "double-four-trap",
    )!;
    expect(doubleFourDef.matches(forkPoints[0])).toBe(false);
  });

  it("ALL_FORK_PATTERN_NAMES contains every catalog entry's name", () => {
    for (const def of FORK_PATTERNS) {
      expect(ALL_FORK_PATTERN_NAMES.has(def.name)).toBe(true);
    }
    expect(ALL_FORK_PATTERN_NAMES.size).toBe(FORK_PATTERNS.length);
  });
});

describe("recognizedForkPoints", () => {
  const board = parseBoard(`
    .......
    .....X.
    ...XX..
    .....X.
    .......
  `);
  const patterns = findPatterns(board, 1);

  it("returns the fork point when its catalog entry is recognized", () => {
    const result = recognizedForkPoints(
      patterns,
      new Set(["double-three-trap"]),
    );
    expect(result).toHaveLength(1);
  });

  it("returns nothing when no catalog entry is recognized", () => {
    const result = recognizedForkPoints(patterns, new Set());
    expect(result).toEqual([]);
  });

  it("returns nothing when only an unrelated catalog entry is recognized", () => {
    const result = recognizedForkPoints(
      patterns,
      new Set(["double-four-trap"]),
    );
    expect(result).toEqual([]);
  });
});
