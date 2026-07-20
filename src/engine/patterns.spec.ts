import {
  findForkPoints,
  findPatterns,
  findPatternsOnLine,
  lineKey,
} from "./patterns.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

describe("lineKey", () => {
  it("groups cells on the same diagonal", () => {
    expect(lineKey(3, 1, [1, 1])).toBe(lineKey(5, 3, [1, 1]));
    expect(lineKey(3, 1, [1, 1])).not.toBe(lineKey(3, 2, [1, 1]));
  });

  it("groups cells on the same anti-diagonal", () => {
    expect(lineKey(2, 5, [1, -1])).toBe(lineKey(4, 3, [1, -1]));
  });
});

describe("findPatternsOnLine vs findPatterns", () => {
  it("horizontal line patterns are a subset of the full scan", () => {
    const board = parseBoard(`
      .......
      .XX.X..
      ..O....
      .......
    `);
    const onLine = findPatternsOnLine(board, 1, 1, 1, [0, 1]);
    const full = findPatterns(board, 1);
    for (const p of onLine) {
      expect(p.direction).toEqual([0, 1]);
      expect(
        full.some(
          (f) =>
            f.type === p.type &&
            f.cells.map((c) => `${c.row},${c.col}`).sort().join("|") ===
              p.cells.map((c) => `${c.row},${c.col}`).sort().join("|"),
        ),
      ).toBe(true);
    }
  });

  it("union of all distinct lines reproduces findPatterns", () => {
    const board = parseBoard(`
      .......
      .XX.X..
      ..O.X..
      ...X...
    `);
    const full = findPatterns(board, 1);
    const seen = new Set<string>();
    const rebuilt: typeof full = [];
    for (let row = 0; row < board.length; row += 1) {
      for (let col = 0; col < board.length; col += 1) {
        if (board[row][col] === 0) {
          continue;
        }
        for (const direction of [
          [0, 1],
          [1, 0],
          [1, 1],
          [1, -1],
        ] as const) {
          const key = `${direction[0]},${direction[1]}:${lineKey(row, col, direction)}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          rebuilt.push(
            ...findPatternsOnLine(board, 1, row, col, direction),
          );
        }
      }
    }
    const canon = (patterns: typeof full) =>
      patterns
        .map(
          (p) =>
            `${p.type}|${p.direction[0]},${p.direction[1]}|${p.cells
              .map((c) => `${c.row},${c.col}`)
              .sort()
              .join("|")}`,
        )
        .sort();
    expect(canon(rebuilt)).toEqual(canon(full));
  });
});

describe("findPatterns — five", () => {
  it("finds a five with no gains", () => {
    const board = parseBoard(`
      .......
      .XXXXX.
      .......
    `);
    const patterns = findPatterns(board, 1);
    const fives = patterns.filter((p) => p.type === "five");
    expect(fives).toHaveLength(1);
    expect(fives[0].gains).toEqual([]);
    expect(fives[0].cells.map((c) => `${c.row},${c.col}`).sort()).toEqual(
      [1, 2, 3, 4, 5].map((col) => `1,${col}`).sort(),
    );
  });

  it("reports a five for an overline (six in a row) when at least one end is open", () => {
    const board = parseBoard(`
      ........
      .XXXXXX.
      ........
    `);
    const patterns = findPatterns(board, 1);
    expect(patterns.filter((p) => p.type === "five").length).toBeGreaterThan(0);
  });

  it("does not report a five for an overline blocked at both ends", () => {
    const board = parseBoard("OXXXXXXO");
    const patterns = findPatterns(board, 1);
    expect(patterns.filter((p) => p.type === "five")).toHaveLength(0);
  });

  it("does not report a five blocked at both ends", () => {
    const board = parseBoard("OXXXXXO");
    const patterns = findPatterns(board, 1);
    expect(patterns.filter((p) => p.type === "five")).toHaveLength(0);
  });

  it("finds no patterns for the opponent on a board with only one player's stones", () => {
    const board = parseBoard(`
      .......
      .XXXXX.
      .......
    `);
    expect(findPatterns(board, 2)).toEqual([]);
  });
});

describe("findPatterns — four / open-four", () => {
  it("classifies a four with two open ends as open-four", () => {
    const board = parseBoard(".XXXX.");
    const patterns = findPatterns(board, 1);
    const fours = patterns.filter((p) => p.type === "open-four");
    expect(fours).toHaveLength(1);
    expect(fours[0].gains.map((g) => g.col).sort()).toEqual([0, 5]);
    expect(fours[0].criticalGains).toEqual(fours[0].gains);
  });

  it("classifies a four blocked at one end as a plain four with one win square", () => {
    const board = parseBoard("OXXXX.");
    const patterns = findPatterns(board, 1);
    const fours = patterns.filter((p) => p.type === "four");
    expect(fours).toHaveLength(1);
    expect(fours[0].gains.map((g) => g.col)).toEqual([5]);
  });

  it("reports no four when blocked at both ends", () => {
    const board = parseBoard("OXXXXO");
    const patterns = findPatterns(board, 1);
    expect(
      patterns.filter((p) => p.type === "four" || p.type === "open-four"),
    ).toHaveLength(0);
  });

  it("treats gapped shapes that complete to five-or-more as plain fours (XOOOO.O / XOO.OOO / XOOO.OO)", () => {
    for (const { ascii, gainCol } of [
      { ascii: "XOOOO.O", gainCol: 5 },
      { ascii: "XOO.OOO", gainCol: 3 },
      { ascii: "XOOO.OO", gainCol: 4 },
    ]) {
      const patterns = findPatterns(parseBoard(ascii), 2);
      const fours = patterns.filter((p) => p.type === "four");
      expect(fours.length).toBeGreaterThanOrEqual(1);
      const gainCols = new Set(
        fours.flatMap((p) => p.gains.map((g) => g.col)),
      );
      expect(gainCols.has(gainCol)).toBe(true);
    }
  });

  it("does not treat a gapped overline as a four when both ends are already boxed", () => {
    const board = parseBoard("XOOOO.OX");
    const patterns = findPatterns(board, 2);
    expect(
      patterns.filter((p) => p.type === "four" || p.type === "open-four"),
    ).toHaveLength(0);
  });
});

describe("findPatterns — subset suppression", () => {
  it("does not emit a two that is just two stones of a same-line three", () => {
    // Diagonal three; without suppression the leading pair also forms a
    // viable two-window once overlines are allowed, which then false-
    // positives as a mixed-tier fork with the three (catalog #2).
    const board = parseBoard(`
       6  7  8  9 10 11 12 13 14 15 16 17
    9  .  .  .  .  .  .  .  X  .  .  .  .
   10  .  .  .  .  .  .  X  X  .  .  .  .
   11  .  .  .  .  .  X  O  .  .  .  .  .
   12  .  .  .  .  O  O  .  .  .  .  .  .
    `);
    const patterns = findPatterns(board, 1);
    expect(patterns.filter((p) => p.type === "three")).toHaveLength(1);
    expect(
      patterns.filter(
        (p) =>
          p.type === "two" &&
          p.direction[0] === 1 &&
          p.direction[1] === -1,
      ),
    ).toHaveLength(0);
    expect(findForkPoints(patterns)).toEqual([]);
  });
});

describe("findPatterns — three / open-three (design doc worked examples)", () => {
  it("OXXX. classifies as three: only simple fours are reachable", () => {
    // Width matters here: with WIN_LENGTH=5, "OXXX." (5 cols) has exactly one
    // sliding window and it contains the O, so nothing would be found at all.
    // The extra trailing "." gives a second window that excludes the O.
    const board = parseBoard("OXXX..");
    const patterns = findPatterns(board, 1);
    const threes = patterns.filter((p) => p.type === "three");
    expect(threes).toHaveLength(1);
    const opens = patterns.filter((p) => p.type === "open-three");
    expect(opens).toHaveLength(0);
  });

  it("O.XXX. classifies as open-three: the right end yields two win squares", () => {
    // Same width issue as above: "O.XXX." (6 cols) has only one O-free
    // window, which caps the reachable four at one open end (blocked by the
    // board edge on the other) — never open-four. The extra trailing "."
    // gives col 5's gain room to open on both flanks.
    const board = parseBoard("O.XXX..");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-three");
    expect(opens).toHaveLength(1);
    // Filling col 1 only yields a blocked four (O is beyond it); only col 5 opens up to open-four.
    expect(opens[0].criticalGains.map((g) => g.col)).toEqual([5]);
  });

  it("O..XXX. classifies as open-three through the gaps", () => {
    const board = parseBoard("O..XXX.");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-three");
    expect(opens).toHaveLength(1);
  });

  it("O.XXXO reports no three: no viable window exists", () => {
    const board = parseBoard("O.XXXO");
    const patterns = findPatterns(board, 1);
    expect(
      patterns.filter((p) => p.type === "three" || p.type === "open-three"),
    ).toHaveLength(0);
  });
});

describe("findPatterns — two / open-two", () => {
  it("classifies an isolated two with room to grow as open-two", () => {
    const board = parseBoard("..XX...");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-two");
    expect(opens.length).toBeGreaterThanOrEqual(1);
    expect(opens[0].criticalGains.length).toBeGreaterThan(0);
  });

  it("classifies a two boxed in on one side as a plain two, not open-two", () => {
    // "OXX.." (5 cols) has exactly one window and it contains the O, so
    // nothing would be found - same width trap as Task 5. Widen by one.
    const board = parseBoard("OXX...");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-two");
    expect(opens).toHaveLength(0);
    const twos = patterns.filter((p) => p.type === "two");
    expect(twos.length).toBeGreaterThanOrEqual(1);
  });
});

describe("findForkPoints", () => {
  it("finds a fork point where an open-three and a four (different directions) share a gain", () => {
    // Horizontal open-three centered so its right-side gain is (2, 5);
    // vertical four whose single gain is also (2, 5).
    const board = parseBoard(`
      .......
      .......
      O.XXX..
      .....X.
      .....X.
      .....X.
      .......
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    const atTarget = forkPoints.filter(
      (f) => f.move.row === 2 && f.move.col === 5,
    );
    expect(atTarget).toHaveLength(1);
    const directions = new Set(
      atTarget[0].patterns.map((p) => `${p.direction[0]},${p.direction[1]}`),
    );
    expect(directions.size).toBeGreaterThanOrEqual(2);
  });

  it("finds a double-three fork: two open-twos that each promote to open-three from the same move", () => {
    // Horizontal open-two at row 2 (cols 3-4) promotes to open-three by
    // filling (2, 5); vertical open-two at col 5 (rows 1 and 3, split by a
    // gap) promotes to open-three by filling that same gap at (2, 5).
    // Neither line is severe yet on its own — this is exactly the shape the
    // original SEVERE_TYPES-only definition missed.
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    const atTarget = forkPoints.filter(
      (f) => f.move.row === 2 && f.move.col === 5,
    );
    expect(atTarget).toHaveLength(1);
    expect(atTarget[0].patterns.every((p) => p.type === "open-two")).toBe(
      true,
    );
    const directions = new Set(
      atTarget[0].patterns.map((p) => `${p.direction[0]},${p.direction[1]}`),
    );
    expect(directions.size).toBeGreaterThanOrEqual(2);
  });

  it("does not report a fork point for a single severe pattern in one direction", () => {
    const board = parseBoard(".XXXX.");
    const patterns = findPatterns(board, 1);
    expect(findForkPoints(patterns)).toEqual([]);
  });

  it("does not report a fork for a single open-two even though it will promote to open-three", () => {
    const board = parseBoard("..XX...");
    const patterns = findPatterns(board, 1);
    expect(findForkPoints(patterns)).toEqual([]);
  });

  it("ignores plain two/three patterns when looking for forks", () => {
    const board = parseBoard(`
      ..XX...
      .......
      ..XX...
    `);
    const patterns = findPatterns(board, 1);
    expect(findForkPoints(patterns)).toEqual([]);
  });
});
