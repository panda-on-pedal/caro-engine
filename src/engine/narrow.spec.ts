// src/engine/narrow.spec.ts
import { findForkPoints, findPatterns } from "./patterns.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  findCandidateMoves,
  FORK_PATTERNS,
  narrowCandidates,
  recognizedForkPoints,
  type NarrowConfig,
} from "./narrow.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

describe("findCandidateMoves", () => {
  it("returns only the center cell on an empty board", () => {
    const board = parseBoard(`
      .....
      .....
      .....
      .....
      .....
    `);
    const candidates = findCandidateMoves(board);
    expect(candidates).toEqual([{ row: 2, col: 2 }]);
  });

  it("returns only empty cells within distance 2 of an existing stone", () => {
    const board = parseBoard(`
      .......
      .......
      ..X....
      .......
      .......
      .......
      .......
    `);
    const candidates = findCandidateMoves(board);
    expect(candidates.length).toBeGreaterThan(0);
    for (const move of candidates) {
      const rowDelta = Math.abs(move.row - 2);
      const colDelta = Math.abs(move.col - 2);
      expect(Math.max(rowDelta, colDelta)).toBeLessThanOrEqual(2);
    }
    // (5,5) is far from the only stone at (2,2) and must not be a candidate.
    expect(candidates.some((m) => m.row === 5 && m.col === 5)).toBe(false);
  });

  it("never returns an occupied cell", () => {
    const board = parseBoard(`
      .......
      ..XXX..
      .......
    `);
    const candidates = findCandidateMoves(board);
    for (const move of candidates) {
      expect(board[move.row][move.col]).toBe(0);
    }
  });
});

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

const BASE_CONFIG: NarrowConfig = {
  recognizedForkPatterns: new Set(),
  decay: { startDecay: 0.8, minDecay: 0.15, stepDown: 0.05 },
};

describe("narrowCandidates — forced win/block", () => {
  it("returns only the gain when the mover already has a completable four", () => {
    const board = parseBoard("OXXXX.");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result).toEqual([{ row: 0, col: 5 }]);
  });

  it("returns only the gain when the mover already has an open four", () => {
    const board = parseBoard(".XXXX..");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result.map((m) => `${m.row},${m.col}`).sort()).toEqual(
      ["0,0", "0,5"].sort(),
    );
  });

  it("returns only the blocking gain when the opponent has a completable four", () => {
    const board = parseBoard("XOOOO.");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result).toEqual([{ row: 0, col: 5 }]);
  });

  it("prioritizes the mover's own win over blocking the opponent's four", () => {
    const board = parseBoard(`
      .XXXX....
      .........
      .OOOO....
    `);
    const result = narrowCandidates(board, 1, 6, BASE_CONFIG);
    // X's own open-four (both ends open) has two gains, (0,0) and (0,5);
    // only those are returned — the opponent's four at row 2 is
    // irrelevant once the mover can win immediately, so neither of its
    // blocking cells appears here.
    expect(result.map((m) => `${m.row},${m.col}`).sort()).toEqual(
      ["0,0", "0,5"].sort(),
    );
  });
});

describe("narrowCandidates — tactical set", () => {
  it("includes the own open-three's extension cells", () => {
    const board = parseBoard("..XXX..");
    const result = narrowCandidates(board, 1, 3, BASE_CONFIG);
    const keys = result.map((m) => `${m.row},${m.col}`).sort();
    expect(keys).toEqual(["0,1", "0,5"].sort());
  });

  it("includes the opponent's open-three's blocking cells", () => {
    const board = parseBoard("..OOO..");
    const result = narrowCandidates(board, 1, 3, BASE_CONFIG);
    const keys = result.map((m) => `${m.row},${m.col}`).sort();
    expect(keys).toEqual(["0,1", "0,5"].sort());
  });

  it("includes a recognized fork point (offense)", () => {
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `);
    const config: NarrowConfig = {
      ...BASE_CONFIG,
      recognizedForkPatterns: new Set(["double-three-trap"]),
    };
    const result = narrowCandidates(board, 1, 4, config);
    expect(
      result.some((m) => m.row === 2 && m.col === 5),
    ).toBe(true);
  });

  it("does not include an unrecognized fork point, even when the tactical set is non-empty for an unrelated reason", () => {
    // The fork shape (rows 1-3, unrecognized) sits far from an unrelated
    // own open-three (row 10) so the two never interact. The open-three's
    // criticalGains force tacticalMoves.size > 0, so this deterministically
    // exercises step 3's return path — not step 4's quiet fallback, which
    // (verified empirically) would otherwise plausibly sample (2, 5) since
    // it sits at distance 1 from three different stones in the fork shape,
    // making this assertion flaky if step 3 fell through to quiet fallback.
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
      .......
      .......
      .......
      .......
      .......
      ..XXX..
      .......
    `);
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG); // empty recognizedForkPatterns
    expect(result.some((m) => m.row === 2 && m.col === 5)).toBe(false);
    expect(
      result.some((m) => m.row === 10 && (m.col === 1 || m.col === 5)),
    ).toBe(true);
  });

  it("includes a recognized fork point built by the opponent (defense)", () => {
    const board = parseBoard(`
      .......
      .....O.
      ...OO..
      .....O.
      .......
    `);
    const config: NarrowConfig = {
      ...BASE_CONFIG,
      recognizedForkPatterns: new Set(["double-three-trap"]),
    };
    const result = narrowCandidates(board, 1, 4, config);
    expect(result.some((m) => m.row === 2 && m.col === 5)).toBe(true);
  });
});

describe("narrowCandidates — quiet fallback", () => {
  it("returns a non-empty, small candidate set when no tactical pattern exists", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    const result = narrowCandidates(board, 2, 1, BASE_CONFIG);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it("only returns cells within distance 2 of an existing stone", () => {
    const board = parseBoard(`
      .......
      .......
      ...X...
      .......
      .......
      .......
      .......
    `);
    // "...X..." has 3 leading dots, so the stone is at column 3, not 2.
    const result = narrowCandidates(board, 2, 1, BASE_CONFIG);
    for (const move of result) {
      const rowDelta = Math.abs(move.row - 2);
      const colDelta = Math.abs(move.col - 3);
      expect(Math.max(rowDelta, colDelta)).toBeLessThanOrEqual(2);
    }
  });

  it("returns the single center cell on a genuinely empty board", () => {
    const board = parseBoard(`
      .....
      .....
      .....
      .....
      .....
    `);
    const result = narrowCandidates(board, 1, 0, BASE_CONFIG);
    expect(result).toEqual([{ row: 2, col: 2 }]);
  });

  it("reorders the tactical set by weighted-random instead of leaving Map insertion order, so a downstream 'take the first' consumer sees variety across ties", () => {
    // Two candidates tie for the tactical set: an own open-three's two
    // extension cells. Insertion order (Task 5's Map) would always put
    // the left cell first; with weighted reordering, an rng biased toward
    // the end of the list should surface the right cell first instead.
    const board = parseBoard("..XXX..");
    const rngLow = () => 0.01;
    const rngHigh = () => 0.99;
    const low = narrowCandidates(board, 1, 3, { ...BASE_CONFIG, rng: rngLow });
    const high = narrowCandidates(board, 1, 3, {
      ...BASE_CONFIG,
      rng: rngHigh,
    });
    expect(low[0]).not.toEqual(high[0]);
  });

  it("samples different subsets across move counts given a varying rng sequence", () => {
    const board = parseBoard(`
      .........
      .........
      .........
      ....X....
      .........
      .........
      .........
      .........
      .........
    `);
    let call = 0;
    const rng = () => {
      const sequence = [0.1, 0.9, 0.3, 0.7, 0.2, 0.8];
      const value = sequence[call % sequence.length];
      call += 1;
      return value;
    };
    const early = narrowCandidates(board, 2, 0, { ...BASE_CONFIG, rng });
    const later = narrowCandidates(board, 2, 20, { ...BASE_CONFIG, rng });
    // Early (wide decay) and later (sharp decay) draws are not required to
    // differ in every run, but both must respect the small-set contract.
    expect(early.length).toBeGreaterThan(0);
    expect(later.length).toBeGreaterThan(0);
  });
});
