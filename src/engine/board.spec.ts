import { BOARD_SIZE, checkWin, createEmptyBoard, isFull, isLegalMove, placeMove } from './board.ts';

describe('createEmptyBoard', () => {
  it('creates a BOARD_SIZE x BOARD_SIZE board of empty cells', () => {
    const board = createEmptyBoard();
    expect(board.length).toBe(BOARD_SIZE);
    expect(board.every((row) => row.length === BOARD_SIZE)).toBe(true);
    expect(board.every((row) => row.every((cell) => cell === 0))).toBe(true);
  });
});

describe('isLegalMove / placeMove', () => {
  it('rejects out-of-bounds and occupied cells', () => {
    let board = createEmptyBoard();
    expect(isLegalMove(board, -1, 0)).toBe(false);
    expect(isLegalMove(board, 0, BOARD_SIZE)).toBe(false);

    board = placeMove(board, 3, 3, 1);
    expect(isLegalMove(board, 3, 3)).toBe(false);
    expect(() => placeMove(board, 3, 3, 2)).toThrow();
  });

  it('does not mutate the original board', () => {
    const board = createEmptyBoard();
    const next = placeMove(board, 0, 0, 1);
    expect(board[0][0]).toBe(0);
    expect(next[0][0]).toBe(1);
  });
});

describe('isFull', () => {
  it('is false for an empty board and true once every cell is filled', () => {
    const empty = createEmptyBoard(2);
    expect(isFull(empty)).toBe(false);

    let full = createEmptyBoard(2);
    full = placeMove(full, 0, 0, 1);
    full = placeMove(full, 0, 1, 2);
    full = placeMove(full, 1, 0, 1);
    full = placeMove(full, 1, 1, 2);
    expect(isFull(full)).toBe(true);
  });
});

describe('checkWin', () => {
  it('detects a horizontal five-in-a-row', () => {
    let board = createEmptyBoard();
    for (let col = 0; col < 5; col += 1) {
      board = placeMove(board, 5, col, 1);
    }
    expect(checkWin(board, 5, 4, 1)).toBe(true);
  });

  it('detects a vertical five-in-a-row', () => {
    let board = createEmptyBoard();
    for (let row = 0; row < 5; row += 1) {
      board = placeMove(board, row, 2, 2);
    }
    expect(checkWin(board, 4, 2, 2)).toBe(true);
  });

  it('detects a diagonal (top-left to bottom-right) five-in-a-row', () => {
    let board = createEmptyBoard();
    for (let i = 0; i < 5; i += 1) {
      board = placeMove(board, i, i, 1);
    }
    expect(checkWin(board, 2, 2, 1)).toBe(true);
  });

  it('detects an anti-diagonal (top-right to bottom-left) five-in-a-row', () => {
    let board = createEmptyBoard();
    for (let i = 0; i < 5; i += 1) {
      board = placeMove(board, i, 4 - i, 2);
    }
    expect(checkWin(board, 2, 2, 2)).toBe(true);
  });

  it('returns false when there are only four in a row', () => {
    let board = createEmptyBoard();
    for (let col = 0; col < 4; col += 1) {
      board = placeMove(board, 5, col, 1);
    }
    expect(checkWin(board, 5, 3, 1)).toBe(false);
  });

  it('returns false when the queried cell belongs to the other player', () => {
    let board = createEmptyBoard();
    for (let col = 0; col < 5; col += 1) {
      board = placeMove(board, 5, col, 1);
    }
    expect(checkWin(board, 5, 4, 2)).toBe(false);
  });
});
