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
