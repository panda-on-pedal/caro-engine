import { createEmptyBoard, type Board, type Cell } from "../board.ts";

const SYMBOLS: Record<string, Cell> = { ".": 0, X: 1, O: 2 };
const ALL_DIGITS = /^\d+$/;

/**
 * A diagram is "labeled" (row/col numbers, as pasted from an inspection
 * log or docs/superpowers/plans/2026-07-18-board-state-catalog.md) rather
 * than plain sequential-index rows when its first line is entirely column
 * numbers and its second line starts with a row number — plain rows are
 * always `.`/`X`/`O` characters, which never parse as all-digit tokens.
 */
function isLabeledFormat(lines: readonly string[]): boolean {
  if (lines.length < 2) {
    return false;
  }
  const header = lines[0].split(/\s+/);
  const firstRowLabel = lines[1].split(/\s+/)[0];
  return header.every(token => ALL_DIGITS.test(token)) && ALL_DIGITS.test(firstRowLabel);
}

function symbolFor(token: string): Cell {
  const value = SYMBOLS[token];
  if (value === undefined) {
    throw new Error(`Unknown symbol "${token}" in parseBoard input`);
  }
  return value;
}

/**
 * Parses a diagram whose first line is a header of column numbers and
 * each following line starts with a row number, e.g.:
 *
 *        6  7  8  9 10 11 12 13
 *     7  .  .  .  .  .  .  .  .
 *     8  .  O  O  O  X  O  .  .
 *
 * Stones are placed at their *labeled* row/col coordinates (not
 * sequential index), so a diagram can be pasted verbatim from a catalog
 * entry or engine log without manually translating coordinates. The
 * returned board is padded to a square that fits every labeled
 * coordinate (at least `minSize`).
 */
function parseLabeledBoard(lines: readonly string[], minSize: number): Board {
  const [headerLine, ...rowLines] = lines;
  const cols = headerLine.split(/\s+/).map(Number);

  const placements: Array<{ row: number; col: number; symbol: string }> = [];
  let maxCoord = minSize - 1;

  for (const line of rowLines) {
    const [rowLabel, ...cells] = line.split(/\s+/);
    const row = Number(rowLabel);
    if (cells.length !== cols.length) {
      throw new Error(
        `Row ${rowLabel} has ${cells.length} cells but the header declares ${cols.length} columns`
      );
    }
    cells.forEach((symbol, i) => {
      const col = cols[i];
      maxCoord = Math.max(maxCoord, row, col);
      if (symbol !== ".") {
        placements.push({ row, col, symbol });
      }
    });
  }

  const board = createEmptyBoard(maxCoord + 1);
  for (const { row, col, symbol } of placements) {
    board[row][col] = symbolFor(symbol);
  }
  return board;
}

/**
 * Parses an ASCII board diagram into a Board for tests. `.` = empty,
 * `X` = player 1, `O` = player 2. One line per row; whitespace within and
 * around lines is ignored. Pads to a square board (the larger of row count
 * and longest row) since board.ts's isInBounds assumes square boards;
 * padding cells stay empty.
 *
 * Also accepts the labeled row/col-number format (see
 * `parseLabeledBoard`'s doc comment above) — detected automatically, so a
 * diagram copied straight out of an inspection log or the board-state
 * catalog doesn't need its header stripped first. `minSize` only applies
 * to that labeled form, since the plain form always pads from (0,0).
 */
export function parseBoard(ascii: string, minSize = 20): Board {
  const lines = ascii
    .trim()
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (isLabeledFormat(lines)) {
    return parseLabeledBoard(lines, minSize);
  }

  const rows = lines.map(line => line.replace(/\s+/g, "").split(""));

  const numRows = rows.length;
  const numCols = Math.max(...rows.map(row => row.length));
  const size = Math.max(numRows, numCols);

  const board = createEmptyBoard(size);
  rows.forEach((row, r) => {
    row.forEach((symbol, c) => {
      board[r][c] = symbolFor(symbol);
    });
  });
  return board;
}
