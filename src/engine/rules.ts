import { isInBounds, WIN_LENGTH, type Board, type Player } from './board.ts';
import type { Move } from './state.ts';

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * Returns the five cells of a Caro-legal win through `(row, col)` when the
 * stone just placed there completes one: a run of exactly five stones, not
 * blocked by an opponent stone at both ends. The board edge never counts as a
 * block; a run of six or more (overline) never wins even though it contains
 * five consecutive stones.
 */
export function findCaroWinLine(
  board: Board,
  row: number,
  col: number,
  player: Player,
): Move[] | null {
  if (board[row][col] !== player) {
    return null;
  }

  const opponent: Player = player === 1 ? 2 : 1;

  for (const [dRow, dCol] of DIRECTIONS) {
    let startRow = row;
    let startCol = col;
    while (
      isInBounds(board, startRow - dRow, startCol - dCol) &&
      board[startRow - dRow][startCol - dCol] === player
    ) {
      startRow -= dRow;
      startCol -= dCol;
    }

    let endRow = row;
    let endCol = col;
    while (
      isInBounds(board, endRow + dRow, endCol + dCol) &&
      board[endRow + dRow][endCol + dCol] === player
    ) {
      endRow += dRow;
      endCol += dCol;
    }

    const runLength =
      Math.max(Math.abs(endRow - startRow), Math.abs(endCol - startCol)) + 1;
    if (runLength !== WIN_LENGTH) {
      continue;
    }

    const blockedBefore =
      isInBounds(board, startRow - dRow, startCol - dCol) &&
      board[startRow - dRow][startCol - dCol] === opponent;
    const blockedAfter =
      isInBounds(board, endRow + dRow, endCol + dCol) &&
      board[endRow + dRow][endCol + dCol] === opponent;
    if (blockedBefore && blockedAfter) {
      continue;
    }

    const line: Move[] = [];
    for (let r = startRow, c = startCol; ; r += dRow, c += dCol) {
      line.push({ row: r, col: c });
      if (r === endRow && c === endCol) {
        break;
      }
    }
    return line;
  }

  return null;
}

/**
 * Checks whether the stone just placed at (row, col) completes a
 * Caro-legal five: a run of exactly five stones, not blocked by an
 * opponent stone at both ends. The board edge never counts as a block;
 * a run of six or more (overline) never wins even though it contains
 * five consecutive stones.
 */
export function checkCaroWin(board: Board, row: number, col: number, player: Player): boolean {
  return findCaroWinLine(board, row, col, player) !== null;
}
