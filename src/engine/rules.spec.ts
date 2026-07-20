import { placeMove } from './board.ts';
import { parseBoard } from './test-helpers/parse-board.ts';
import { checkCaroWin, findCaroWinLine } from './rules.ts';

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

  it('wins on an overline (six or more) when at least one end is open', () => {
    const board = parseBoard(`
      ........
      .XXXXXX.
      ........
    `);
    expect(checkCaroWin(board, 1, 3, 1)).toBe(true);
    expect(checkCaroWin(board, 1, 4, 1)).toBe(true);
  });

  it('does not win on an overline blocked at both ends', () => {
    const board = parseBoard('OXXXXXXO');
    expect(checkCaroWin(board, 0, 3, 1)).toBe(false);
  });

  it('wins when filling a gap completes five-or-more (XOOOO.O, XOO.OOO, XOOO.OO)', () => {
    expect(checkCaroWin(parseBoard('XOOOO.O'), 0, 5, 2)).toBe(false); // gap empty — not yet
    expect(checkCaroWin(placeMove(parseBoard('XOOOO.O'), 0, 5, 2), 0, 5, 2)).toBe(true);
    expect(checkCaroWin(placeMove(parseBoard('XOO.OOO'), 0, 3, 2), 0, 3, 2)).toBe(true);
    expect(checkCaroWin(placeMove(parseBoard('XOOO.OO'), 0, 4, 2), 0, 4, 2)).toBe(true);
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

describe('findCaroWinLine', () => {
  it('returns the five horizontal cells through the winning stone', () => {
    const board = parseBoard(`
      .......
      .XXXXX.
      .......
    `);
    expect(findCaroWinLine(board, 1, 3, 1)).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 1, col: 3 },
      { row: 1, col: 4 },
      { row: 1, col: 5 },
    ]);
  });

  it('returns null for a double-blocked five', () => {
    const board = parseBoard('OXXXXXO');
    expect(findCaroWinLine(board, 0, 3, 1)).toBeNull();
  });

  it('returns the full overline when six or more win', () => {
    const board = parseBoard(`
      ........
      .XXXXXX.
      ........
    `);
    expect(findCaroWinLine(board, 1, 3, 1)).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 1, col: 3 },
      { row: 1, col: 4 },
      { row: 1, col: 5 },
      { row: 1, col: 6 },
    ]);
  });

  it('returns null for a double-blocked overline', () => {
    const board = parseBoard('OXXXXXXO');
    expect(findCaroWinLine(board, 0, 3, 1)).toBeNull();
  });

  it('returns the diagonal line through the queried cell', () => {
    const board = parseBoard(`
      X....
      .X...
      ..X..
      ...X.
      ....X
    `);
    expect(findCaroWinLine(board, 2, 2, 1)).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 2 },
      { row: 3, col: 3 },
      { row: 4, col: 4 },
    ]);
  });

  it('returns null when the queried cell is not on a winning line', () => {
    let board = parseBoard(`
      .........
      .XXXXX...
      .........
      .........
      .........
    `);
    board = placeMove(board, 3, 0, 1);
    expect(findCaroWinLine(board, 3, 0, 1)).toBeNull();
  });
});
