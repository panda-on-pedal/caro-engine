import { placeMove } from './board.ts';
import { parseBoard } from './test-helpers/parse-board.ts';
import { checkCaroWin } from './rules.ts';

describe('checkCaroWin', () => {
  it('wins on a five blocked at neither end', () => {
    const board = parseBoard(`
      .......
      .XXXXX.
      .......
    `);
    expect(checkCaroWin(board, 1, 3, 1)).toBe(true);
  });

  it('wins on a five blocked at exactly one end (board edge is not a block)', () => {
    const board = parseBoard('XXXXXO');
    expect(checkCaroWin(board, 0, 2, 1)).toBe(true);
  });

  it('does not win on a five blocked at both ends', () => {
    const board = parseBoard('OXXXXXO');
    expect(checkCaroWin(board, 0, 3, 1)).toBe(false);
  });

  it('does not win on an overline (six in a row), even though it contains five consecutive stones', () => {
    const board = parseBoard(`
      ........
      .XXXXXX.
      ........
    `);
    expect(checkCaroWin(board, 1, 3, 1)).toBe(false);
    expect(checkCaroWin(board, 1, 4, 1)).toBe(false);
  });

  it('detects a vertical five at the board edge', () => {
    const board = parseBoard(`
      X....
      X....
      X....
      X....
      X....
    `);
    expect(checkCaroWin(board, 4, 0, 1)).toBe(true);
  });

  it('detects a diagonal five', () => {
    const board = parseBoard(`
      X....
      .X...
      ..X..
      ...X.
      ....X
    `);
    expect(checkCaroWin(board, 2, 2, 1)).toBe(true);
  });

  it('only evaluates the line through the queried cell, not unrelated fives elsewhere', () => {
    let board = parseBoard(`
      .........
      .XXXXX...
      .........
      .........
      .........
    `);
    board = placeMove(board, 3, 0, 1);
    expect(checkCaroWin(board, 3, 0, 1)).toBe(false);
  });

  it('returns false when the queried cell does not belong to the given player', () => {
    const board = parseBoard('.XXXXX.');
    expect(checkCaroWin(board, 0, 3, 2)).toBe(false);
  });
});
