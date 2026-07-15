import { createEmptyBoard, type Board, type Cell } from "../board.ts";

const SYMBOLS: Record<string, Cell> = { ".": 0, X: 1, O: 2 };

/**
 * Parses an ASCII board diagram into a Board for tests. `.` = empty,
 * `X` = player 1, `O` = player 2. One line per row; whitespace within and
 * around lines is ignored. Pads to a square board (the larger of row count
 * and longest row) since board.ts's isInBounds assumes square boards;
 * padding cells stay empty.
 */
export function parseBoard(ascii: string): Board {
  const rows = ascii
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\s+/g, "").split(""));

  const numRows = rows.length;
  const numCols = Math.max(...rows.map((row) => row.length));
  const size = Math.max(numRows, numCols);

  const board = createEmptyBoard(size);
  rows.forEach((row, r) => {
    row.forEach((symbol, c) => {
      const value = SYMBOLS[symbol];
      if (value === undefined) {
        throw new Error(`Unknown symbol "${symbol}" in parseBoard input`);
      }
      board[r][c] = value;
    });
  });
  return board;
}
