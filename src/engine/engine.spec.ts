import { BOARD_SIZE, isLegalMove } from './board.ts';
import { chooseMove } from './engine.ts';
import { applyMove, newGame } from './state.ts';

describe('chooseMove', () => {
  it('plays the center cell on an empty board', () => {
    const state = newGame();
    const move = chooseMove(state);
    const center = Math.floor(BOARD_SIZE / 2);
    expect(move).toEqual({ row: center, col: center });
  });

  it('returns a legal move adjacent to an existing stone once the board is non-empty', () => {
    let state = newGame();
    state = applyMove(state, { row: 7, col: 7 }, 1);

    const move = chooseMove(state);
    expect(isLegalMove(state.board, move.row, move.col)).toBe(true);

    const rowDelta = Math.abs(move.row - 7);
    const colDelta = Math.abs(move.col - 7);
    expect(Math.max(rowDelta, colDelta)).toBe(1);
  });

  it('always returns an in-bounds legal move across repeated calls', () => {
    let state = newGame();
    state = applyMove(state, { row: 0, col: 0 }, 1);
    state = applyMove(state, { row: 0, col: 1 }, 2);

    for (let i = 0; i < 20; i += 1) {
      const move = chooseMove(state);
      expect(isLegalMove(state.board, move.row, move.col)).toBe(true);
    }
  });
});
