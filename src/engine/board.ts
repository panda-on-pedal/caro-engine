export const BOARD_SIZE = 20;
export const WIN_LENGTH = 5;

/** 0 = empty, 1 = human, 2 = AI */
export type Cell = 0 | 1 | 2;
export type Player = 1 | 2;
export type Board = Cell[][];

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function createEmptyBoard(size: number = BOARD_SIZE): Board {
  return Array.from({ length: size }, () => Array<Cell>(size).fill(0));
}

export function isInBounds(board: Board, row: number, col: number): boolean {
  return row >= 0 && row < board.length && col >= 0 && col < board.length;
}

export function isLegalMove(board: Board, row: number, col: number): boolean {
  return isInBounds(board, row, col) && board[row][col] === 0;
}

export function placeMove(board: Board, row: number, col: number, player: Player): Board {
  if (!isLegalMove(board, row, col)) {
    throw new Error(`Illegal move: (${row}, ${col})`);
  }
  const next = board.map((r) => r.slice()) as Board;
  next[row][col] = player;
  return next;
}

export function isFull(board: Board): boolean {
  return board.every((row) => row.every((cell) => cell !== 0));
}

function countInDirection(
  board: Board,
  row: number,
  col: number,
  player: Player,
  dRow: number,
  dCol: number,
): number {
  let count = 0;
  let r = row + dRow;
  let c = col + dCol;
  while (isInBounds(board, r, c) && board[r][c] === player) {
    count += 1;
    r += dRow;
    c += dCol;
  }
  return count;
}

/** Checks whether placing `player`'s stone at (row, col) completes five in a row. */
export function checkWin(board: Board, row: number, col: number, player: Player): boolean {
  if (board[row][col] !== player) {
    return false;
  }
  return DIRECTIONS.some(([dRow, dCol]) => {
    const forward = countInDirection(board, row, col, player, dRow, dCol);
    const backward = countInDirection(board, row, col, player, -dRow, -dCol);
    return forward + backward + 1 >= WIN_LENGTH;
  });
}
