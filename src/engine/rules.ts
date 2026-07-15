import { isInBounds, WIN_LENGTH, type Board, type Player } from './board.ts';

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * Checks whether the stone just placed at (row, col) completes a
 * Caro-legal five: a run of exactly five stones, not blocked by an
 * opponent stone at both ends. The board edge never counts as a block;
 * a run of six or more (overline) never wins even though it contains
 * five consecutive stones.
 */
export function checkCaroWin(board: Board, row: number, col: number, player: Player): boolean {
  if (board[row][col] !== player) {
    return false;
  }

  const opponent: Player = player === 1 ? 2 : 1;

  return DIRECTIONS.some(([dRow, dCol]) => {
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

    const runLength = Math.max(Math.abs(endRow - startRow), Math.abs(endCol - startCol)) + 1;
    if (runLength !== WIN_LENGTH) {
      return false;
    }

    const beforeRow = startRow - dRow;
    const beforeCol = startCol - dCol;
    const afterRow = endRow + dRow;
    const afterCol = endCol + dCol;

    const blockedBefore =
      isInBounds(board, beforeRow, beforeCol) && board[beforeRow][beforeCol] === opponent;
    const blockedAfter =
      isInBounds(board, afterRow, afterCol) && board[afterRow][afterCol] === opponent;

    return !(blockedBefore && blockedAfter);
  });
}
