import { parseBoard } from "./parse-board.ts";

describe("parseBoard", () => {
  it("parses a simple square diagram", () => {
    const board = parseBoard(`
      X.O
      .X.
      O.X
    `);
    expect(board[0][0]).toBe(1);
    expect(board[0][1]).toBe(0);
    expect(board[0][2]).toBe(2);
    expect(board[1][1]).toBe(1);
    expect(board[2][0]).toBe(2);
    expect(board[2][2]).toBe(1);
  });

  it("pads a non-square fragment into a square board", () => {
    const board = parseBoard("OXXX.");
    expect(board.length).toBe(board[0].length);
    expect(board.length).toBeGreaterThanOrEqual(5);
    expect(board[0][0]).toBe(2);
    expect(board[0][1]).toBe(1);
    expect(board[0][4]).toBe(0);
  });

  it("throws on an unrecognized symbol", () => {
    expect(() => parseBoard("X?X")).toThrow();
  });
});
