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

describe("parseBoard — labeled row/col format", () => {
  it("places stones at their labeled coordinates, not sequential index", () => {
    const board = parseBoard(`
         6  7  8
      7  .  O  .
      8  .  .  X
    `);
    expect(board[7][7]).toBe(2);
    expect(board[8][8]).toBe(1);
    // Sequential-index interpretation (row0/col1) must NOT be used.
    expect(board[0][1]).toBe(0);
  });

  it("handles mixed single- and double-digit row/col labels", () => {
    const board = parseBoard(`
           6  7  8  9 10 11 12 13
        9  .  .  .  .  .  .  .  .
       10  .  .  .  .  .  .  X  .
       11  .  .  .  .  .  X  O  .
       12  .  .  .  .  .  O  .  .
    `);
    expect(board[10][12]).toBe(1);
    expect(board[11][11]).toBe(1);
    expect(board[11][12]).toBe(2);
    expect(board[12][11]).toBe(2);
  });

  it("pads the board to fit the largest labeled coordinate, at least minSize", () => {
    const board = parseBoard(
      `
         3  4
      3  .  X
    `,
      20,
    );
    expect(board.length).toBe(20);

    const bigger = parseBoard(
      `
           20 21
        20  .  X
      `,
      20,
    );
    expect(bigger.length).toBe(22);
    expect(bigger[20][21]).toBe(1);
  });

  it("throws when a row's cell count doesn't match the header's column count", () => {
    expect(() =>
      parseBoard(`
         6  7  8
      7  .  O
    `),
    ).toThrow();
  });

  it("throws on an unknown symbol in labeled form", () => {
    expect(() =>
      parseBoard(`
         6  7
      7  .  ?
    `),
    ).toThrow();
  });

  it("reproduces board-state-catalog.md #3 verbatim (X's diagonal four blocked on one end)", () => {
    // docs/superpowers/plans/2026-07-18-board-state-catalog.md, scenario 3.
    const board = parseBoard(`
           6  7  8  9 10 11 12 13 14 15 16 17
        6  .  .  .  .  .  .  .  .  .  .  .  .
        7  .  .  .  .  .  .  .  .  .  .  .  .
        8  .  .  .  .  .  .  .  .  X  .  .  .
        9  .  .  .  .  .  .  .  X  .  .  .  .
       10  .  .  .  .  .  .  X  .  .  .  .  .
       11  .  .  .  .  .  X  O  .  .  .  .  .
       12  .  .  .  .  O  O  .  .  .  .  .  .
       13  .  .  .  .  .  .  .  .  .  .  .  .
       14  .  .  .  .  .  .  .  .  .  .  .  .
       15  .  .  .  .  .  .  .  .  .  .  .  .
       16  .  .  .  .  .  .  .  .  .  .  .  .
    `);
    expect(board[8][14]).toBe(1);
    expect(board[9][13]).toBe(1);
    expect(board[10][12]).toBe(1);
    expect(board[11][11]).toBe(1);
    expect(board[11][12]).toBe(2);
    expect(board[12][10]).toBe(2);
    expect(board[12][11]).toBe(2);
    // Untouched cells (including the labeled-but-empty ones) stay empty.
    expect(board[7][15]).toBe(0);
    expect(board[6][16]).toBe(0);
  });
});
