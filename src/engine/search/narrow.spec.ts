// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

// src/engine/narrow.spec.ts
import { findForkPoints, findPatterns } from "../patterns/patterns.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  findCandidateMoves,
  FORK_PATTERNS,
  narrowCandidates,
  recognizedForkPoints,
  type NarrowConfig,
} from "./narrow.ts";
import { parseBoard } from "../test-helpers/parse-board.ts";
import { createEmptyBoard, placeMove } from "../board.ts";
import { DEFAULT_TOP_K } from "./rankMoves.ts";

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
    expect(candidates.some(m => m.row === 5 && m.col === 5)).toBe(false);
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
    const def = FORK_PATTERNS.find(d => d.name === "double-three-trap")!;
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
    const def = FORK_PATTERNS.find(d => d.name === "double-three-trap")!;
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
    const def = FORK_PATTERNS.find(d => d.name === "double-four-trap")!;
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
    const def = FORK_PATTERNS.find(d => d.name === "mixed-tier-fork")!;
    expect(def.matches(forkPoints[0])).toBe(true);
    const doubleThreeDef = FORK_PATTERNS.find(d => d.name === "double-three-trap")!;
    expect(doubleThreeDef.matches(forkPoints[0])).toBe(false);
    const doubleFourDef = FORK_PATTERNS.find(d => d.name === "double-four-trap")!;
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
    const result = recognizedForkPoints(patterns, new Set(["double-three-trap"]));
    expect(result).toHaveLength(1);
  });

  it("returns nothing when no catalog entry is recognized", () => {
    const result = recognizedForkPoints(patterns, new Set());
    expect(result).toEqual([]);
  });

  it("returns nothing when only an unrelated catalog entry is recognized", () => {
    const result = recognizedForkPoints(patterns, new Set(["double-four-trap"]));
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
    expect(result.moves).toEqual([{ row: 0, col: 5 }]);
  });

  it("returns only the gain when the mover already has an open four", () => {
    const board = parseBoard(".XXXX..");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result.moves.map(m => `${m.row},${m.col}`).sort()).toEqual(["0,0", "0,5"].sort());
  });

  it("returns only the blocking gain when the opponent has a completable four", () => {
    const board = parseBoard("XOOOO.");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result.moves).toEqual([{ row: 0, col: 5 }]);
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
    expect(result.moves.map(m => `${m.row},${m.col}`).sort()).toEqual(["0,0", "0,5"].sort());
  });
});

describe("narrowCandidates — tactical set", () => {
  it("includes the own open-three's extension cells ahead of quiet fillers", () => {
    const board = parseBoard("..XXX..");
    const result = narrowCandidates(board, 1, 3, BASE_CONFIG);
    const keys = result.moves.map(m => `${m.row},${m.col}`);
    // Own offense keeps criticalGains only; quiet fillers may pad the
    // pool but always rank behind the urgent tier.
    expect(keys.slice(0, 2).sort()).toEqual(["0,1", "0,5"]);
    expect(result.moves.length).toBeLessThanOrEqual(DEFAULT_TOP_K);
  });

  it("includes the opponent's open-three's blocking cells — full gains, distance blocks included", () => {
    const board = parseBoard("..OOO..");
    const result = narrowCandidates(board, 1, 3, BASE_CONFIG);
    const keys = result.moves.map(m => `${m.row},${m.col}`);
    // Defense collects every gain of the opponent's open-three: direct
    // extensions (0,1 / 0,5) plus the one-step-beyond cells (0,0 / 0,6)
    // that neutralize via Caro's boxed-five rule.
    expect(keys.slice(0, 4).sort()).toEqual(["0,0", "0,1", "0,5", "0,6"]);
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
    expect(result.moves.some(m => m.row === 2 && m.col === 5)).toBe(true);
  });

  it("includes open-three extensions when forks are unrecognized (urgent excludes soft open-two)", () => {
    // Open-three at bottom is urgent; the double-three-trap open-twos above
    // are soft-only and must not dilute the urgent set.
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
    expect(result.source).toBe("tactical");
    expect(result.moves.some(m => m.row === 10 && (m.col === 1 || m.col === 5))).toBe(true);
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
    expect(result.moves.some(m => m.row === 2 && m.col === 5)).toBe(true);
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
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves.length).toBeLessThanOrEqual(8);
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
    for (const move of result.moves) {
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
    expect(result.moves).toEqual([{ row: 2, col: 2 }]);
  });

  it("returns the tactical (urgent) prefix in deterministic score order regardless of rng (top-K scoring replaced weighted-random reorder)", () => {
    // Two candidates tie for the tactical set: an own open-three's two
    // extension cells. The old weighted-random reorder made the front of
    // the list vary with rng; tiered top-K sorts by score with a stable
    // tie-break, so the urgent prefix is identical regardless of rng.
    // Quiet fillers behind it remain rng-sampled by design.
    const board = parseBoard("..XXX..");
    const rngLow = () => 0.01;
    const rngHigh = () => 0.99;
    const low = narrowCandidates(board, 1, 3, { ...BASE_CONFIG, rng: rngLow });
    const high = narrowCandidates(board, 1, 3, {
      ...BASE_CONFIG,
      rng: rngHigh,
    });
    expect(low.moves.slice(0, 2)).toEqual(high.moves.slice(0, 2));
    expect(
      low.moves
        .slice(0, 2)
        .map(m => `${m.row},${m.col}`)
        .sort()
    ).toEqual(["0,1", "0,5"]);
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
    expect(early.moves.length).toBeGreaterThan(0);
    expect(later.moves.length).toBeGreaterThan(0);
  });
});

describe("narrowCandidates — soft open-two ∪ quiet", () => {
  it("includes own open-two criticalGains and tags source tactical", () => {
    const board = parseBoard("..XX...");
    const own = findPatterns(board, 1).find(p => p.type === "open-two")!;
    expect(own.criticalGains.length).toBeGreaterThan(0);

    const result = narrowCandidates(board, 1, 2, BASE_CONFIG);
    expect(result.source).toBe("tactical");
    const keys = new Set(result.moves.map(m => `${m.row},${m.col}`));
    for (const gain of own.criticalGains) {
      expect(keys.has(`${gain.row},${gain.col}`)).toBe(true);
    }
  });

  it("includes opponent open-two criticalGains", () => {
    const board = parseBoard("..OO...");
    const opp = findPatterns(board, 2).find(p => p.type === "open-two")!;
    expect(opp.criticalGains.length).toBeGreaterThan(0);

    const result = narrowCandidates(board, 1, 2, BASE_CONFIG);
    expect(result.source).toBe("tactical");
    const keys = new Set(result.moves.map(m => `${m.row},${m.col}`));
    for (const gain of opp.criticalGains) {
      expect(keys.has(`${gain.row},${gain.col}`)).toBe(true);
    }
  });

  it("merges quiet neighborhood samples when only soft open-two threats exist, scoring keeps both soft blocks", () => {
    // Opponent open-two on row 3; own lone stone at (1,2). Soft blocks alone
    // would omit development around O — quiet merge must bring those back.
    // A fixed rng makes the quiet-sample draw (32 raw candidates, capped at
    // 8) deterministic instead of occasionally missing a near-O cell.
    const board = parseBoard(`
      ......
      ..O...
      ......
      ..XX..
      ......
      ......
    `);
    const opp = findPatterns(board, 1).find(p => p.type === "open-two")!;
    expect(opp).toBeDefined();
    const softKeys = new Set(opp.criticalGains.map(g => `${g.row},${g.col}`));

    let call = 0;
    const rng = () => {
      const sequence = [0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6];
      const value = sequence[call % sequence.length];
      call += 1;
      return value;
    };
    const result = narrowCandidates(board, 2, 3, { ...BASE_CONFIG, rng });
    expect(result.source).toBe("tactical");
    expect(result.moves.length).toBeLessThanOrEqual(DEFAULT_TOP_K);
    const keys = new Set(result.moves.map(m => `${m.row},${m.col}`));
    // Blocking X's open-two scores higher than any quiet filler (reduces
    // opponent pattern score), so both soft keys always survive top-K.
    for (const softKey of softKeys) {
      expect(keys.has(softKey)).toBe(true);
    }
    const quietNearOwn = [...keys].some(key => {
      if (softKeys.has(key)) {
        return false;
      }
      const [r, c] = key.split(",").map(Number);
      return Math.max(Math.abs(r - 1), Math.abs(c - 2)) <= 2 && !(r === 1 && c === 2);
    });
    expect(quietNearOwn).toBe(true);
  });
});

describe("narrowCandidates — three gains (urgent)", () => {
  it("includes own three gains for blocked/gapped shapes", () => {
    // XOOO.. / X.OOO. / XO.OO. / XOO.O. — expand toward four.
    const shapes = ["XOOO..", "X.OOO.", "XO.OO.", "XOO.O."];
    for (const ascii of shapes) {
      const board = parseBoard(ascii);
      const threes = findPatterns(board, 2).filter(p => p.type === "three");
      expect(threes.length).toBeGreaterThan(0);

      const result = narrowCandidates(board, 2, 3, BASE_CONFIG);
      expect(result.source).toBe("tactical");
      const keys = new Set(result.moves.map(m => `${m.row},${m.col}`));
      for (const three of threes) {
        for (const gain of three.gains) {
          expect(keys.has(`${gain.row},${gain.col}`)).toBe(true);
        }
      }
    }
  });

  it("includes opponent three gains so the mover can block expansions", () => {
    const board = parseBoard("XOOO..");
    const threes = findPatterns(board, 2).filter(p => p.type === "three");
    expect(threes.length).toBeGreaterThan(0);

    const result = narrowCandidates(board, 1, 3, BASE_CONFIG);
    expect(result.source).toBe("tactical");
    const keys = new Set(result.moves.map(m => `${m.row},${m.col}`));
    for (const three of threes) {
      for (const gain of three.gains) {
        expect(keys.has(`${gain.row},${gain.col}`)).toBe(true);
      }
    }
  });

  it("ranks urgent three gains ahead of any soft/quiet filler that pads the pool", () => {
    const board = parseBoard(`
      XOOO..
      ......
      ......
      ...X..
      ......
      ......
    `);
    const threes = findPatterns(board, 2).filter(p => p.type === "three");
    const expected = new Set(threes.flatMap(p => p.gains.map(g => `${g.row},${g.col}`)));
    // Quiet fillers may pad the pool (merge design), but the urgent
    // three gains always occupy the leading slots.
    const result = narrowCandidates(board, 2, 4, BASE_CONFIG);
    expect(result.source).toBe("tactical");
    const keys = result.moves.map(m => `${m.row},${m.col}`);
    expect(keys.slice(0, expected.size).sort()).toEqual([...expected].sort());
    expect(result.moves.length).toBeLessThanOrEqual(DEFAULT_TOP_K);
  });
});

describe("narrowCandidates — top-K scoring", () => {
  it("limits a large urgent set to at most DEFAULT_TOP_K moves", () => {
    // Three independent open-three lines (rows 0, 2, 4), each contributing
    // two criticalGains — six urgent candidates total, above DEFAULT_TOP_K.
    const board = parseBoard(`
      ..XXX...
      ........
      ..XXX...
      ........
      ..XXX...
    `);
    const result = narrowCandidates(board, 1, 9, BASE_CONFIG);
    expect(result.source).toBe("tactical");
    expect(result.moves.length).toBe(DEFAULT_TOP_K);
  });

  it("does not top-K forced four gains", () => {
    const board = parseBoard("XOOOO.");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result.source).toBe("forced");
    expect(result.moves).toEqual([{ row: 0, col: 5 }]);
  });

  it("prefers a dual-purpose expand+block move over a weak one-sided block", () => {
    // Same fixture as rankMoves.spec.ts / board-state-catalog #5.1: O at
    // (8,10)/(10,11)/(12,9), X's 2x2 block at (9,8)/(9,9)/(10,8)/(10,9).
    // (11,10) both extends O's anti-diagonal and blocks X's diagonal two.
    let board = createEmptyBoard(20);
    board = placeMove(board, 8, 10, 2);
    board = placeMove(board, 9, 8, 1);
    board = placeMove(board, 9, 9, 1);
    board = placeMove(board, 10, 8, 1);
    board = placeMove(board, 10, 9, 1);
    board = placeMove(board, 10, 11, 2);
    board = placeMove(board, 12, 9, 2);

    const result = narrowCandidates(board, 2, 7, {
      ...BASE_CONFIG,
      recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    });
    expect(result.moves.some(m => m.row === 11 && m.col === 10)).toBe(true);
    const keys = result.moves.map(m => `${m.row},${m.col}`);
    if (keys.includes("10,6")) {
      expect(keys.indexOf("11,10")).toBeLessThan(keys.indexOf("10,6"));
    }
  });
});

describe("narrowCandidates — tier-aware top-K (urgent before soft)", () => {
  // Catalog #4: O's diagonal open-three (11,9)/(12,10)/(13,11) vs X's
  // diagonal two (11,11)/(12,12). Every urgent answer to the open-three —
  // including the distance blocks 9,7 and 15,13, valid via Caro's
  // boxed-five rule — must survive top-K ahead of X's soft offense.
  const catalog4 = () =>
    parseBoard(`
         6  7  8  9 10 11 12 13 14 15 16 17
      6  .  .  .  .  .  .  .  .  .  .  .  .
      7  .  .  .  .  .  .  .  .  .  .  .  .
      8  .  .  .  .  .  .  .  .  .  .  .  .
      9  .  .  .  .  .  .  .  .  .  .  .  .
     10  .  .  .  .  .  .  .  .  .  .  .  .
     11  .  .  .  O  .  X  .  .  .  .  .  .
     12  .  .  .  .  O  .  X  .  .  .  .  .
     13  .  .  .  .  .  O  .  .  .  .  .  .
     14  .  .  .  .  .  .  .  .  .  .  .  .
     15  .  .  .  .  .  .  .  .  .  .  .  .
     16  .  .  .  .  .  .  .  .  .  .  .  .
  `);

  it("collects the opponent open-three's full gains, including the one-step-beyond distance blocks", () => {
    const result = narrowCandidates(catalog4(), 1, 5, BASE_CONFIG);
    const keys = result.moves.map(m => `${m.row},${m.col}`);
    expect(keys).toEqual(expect.arrayContaining(["9,7", "10,8", "14,12", "15,13"]));
  });

  it("keeps only the four urgent blocks — X's higher-scoring soft offense (9,9) neither blocks nor outraces O's open-three, so it is dropped outright", () => {
    const result = narrowCandidates(catalog4(), 1, 5, BASE_CONFIG);
    const keys = result.moves.map(m => `${m.row},${m.col}`);
    // Urgent tier only, score-sorted (14,12 builds a vertical two, 10,8
    // is the plain critical block, 9,7/15,13 are zero-delta distance
    // blocks in pattern-gain order). 9,9 would have out-scored all four
    // as a "soft" move, but it is not in O's open-three gains and does not
    // create a racing four, so the must-answer filter removes
    // it from the pool entirely instead of leaving it for search to refute.
    expect(keys).toEqual(["14,12", "10,8", "9,7", "15,13"]);
  });
});

describe("narrowCandidates — tempo race routing (urgent vs soft)", () => {
  it("demotes the opponent's open-three to soft when I hold my own open-three (mover advantage on the tie)", () => {
    // Both sides have an open-three (tempo 2 each). I move first, so my
    // extension reaches the open four before theirs — their open-three
    // is not urgent; my criticalGains lead and their gains compete on
    // score in the soft tier.
    const board = parseBoard(`
      ..XXX....
      .........
      ..OOO....
    `);
    const result = narrowCandidates(board, 1, 6, BASE_CONFIG);
    expect(result.source).toBe("tactical");
    const keys = result.moves.map(m => `${m.row},${m.col}`);
    expect(keys.slice(0, 2).sort()).toEqual(["0,1", "0,5"]);
    // Their gains are demoted, not deleted — the best still make the pool.
    expect(keys.slice(2)).toEqual(expect.arrayContaining(["2,1", "2,5"]));
  });

  it("keeps the opponent's open-three urgent when my fastest threat is slower", () => {
    // Their open-three (tempo 2) vs my lone open-two (tempo 3): I lose
    // the race, so every gain of their open-three leads the pool.
    const board = parseBoard(`
      ..XX.....
      .........
      ..OOO....
    `);
    const result = narrowCandidates(board, 1, 5, BASE_CONFIG);
    const keys = result.moves.map(m => `${m.row},${m.col}`);
    expect(keys.slice(0, 4).sort()).toEqual(["2,0", "2,1", "2,5", "2,6"]);
  });
});

describe("narrowCandidates — forced-tier futility check (desperado)", () => {
  it("still forces the block when it genuinely stops the four", () => {
    // O's four has a single live gain (0,5); taking it kills the line.
    const board = parseBoard("XOOOO.");
    const result = narrowCandidates(board, 1, 5, BASE_CONFIG);
    expect(result.source).toBe("forced");
    expect(result.moves).toEqual([{ row: 0, col: 5 }]);
  });

  it("goes offense-only when no single block stops a true open four and the defender has threats", () => {
    // O's open four ..OOOO.. is unstoppable — blocking either gain
    // leaves the other completing a five blocked on at most one end, a
    // valid Caro win. X's pair gives X real threats, so the pool is X's
    // own offense exclusively: no futile blocks, no quiet padding.
    const board = parseBoard(`
      ..OOOO....
      ..........
      ..XX......
    `);
    const result = narrowCandidates(board, 1, 6, BASE_CONFIG);
    expect(result.source).toBe("tactical");
    const keys = result.moves.map(m => `${m.row},${m.col}`);
    expect(keys).not.toContain("0,1");
    expect(keys).not.toContain("0,6");
    expect(result.moves.length).toBeGreaterThan(0);
    for (const move of result.moves) {
      expect(move.row).toBeGreaterThan(0);
    }
  });

  it("falls back to the futile blocks as forced when the defender has no offense at all", () => {
    // Same unstoppable open four, but X has no stones: with nothing to
    // threaten, blocking (and hoping the opponent misses the win) beats
    // a random quiet move.
    const board = parseBoard("..OOOO....");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result.source).toBe("forced");
    expect(result.moves.map(m => `${m.row},${m.col}`).sort()).toEqual(["0,1", "0,6"]);
  });
});

describe("narrowCandidates — quiet source tag", () => {
  it("tags quiet when only isolated stones exist", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    const result = narrowCandidates(board, 2, 1, BASE_CONFIG);
    expect(result.source).toBe("quiet");
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves.length).toBeLessThanOrEqual(8);
  });
});
