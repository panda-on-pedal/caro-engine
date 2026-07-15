import { findPatterns } from "./patterns.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

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

  it("does not report a five for an overline (six in a row)", () => {
    const board = parseBoard(`
      ........
      .XXXXXX.
      ........
    `);
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
});
