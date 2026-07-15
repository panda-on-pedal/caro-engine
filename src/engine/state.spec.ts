import { applyMove, deserializeState, newGame, serializeState } from './state.ts';
import { BOARD_SIZE } from './board.ts';

describe('newGame', () => {
  it('starts with an empty board, player 1 to move, and no winner', () => {
    const state = newGame();
    expect(state.board.length).toBe(BOARD_SIZE);
    expect(state.nextPlayer).toBe(1);
    expect(state.moveHistory).toEqual([]);
    expect(state.winner).toBeNull();
  });
});

describe('applyMove', () => {
  it('places the move, records history, and alternates the next player', () => {
    const state = newGame();
    const next = applyMove(state, { row: 7, col: 7 }, 1);
    expect(next.board[7][7]).toBe(1);
    expect(next.moveHistory).toEqual([{ row: 7, col: 7 }]);
    expect(next.nextPlayer).toBe(2);
    expect(next.winner).toBeNull();
  });

  it('rejects a move when it is not that player\'s turn', () => {
    const state = newGame();
    expect(() => applyMove(state, { row: 0, col: 0 }, 2)).toThrow();
  });

  it('rejects an illegal (occupied) move', () => {
    let state = newGame();
    state = applyMove(state, { row: 0, col: 0 }, 1);
    expect(() => applyMove(state, { row: 0, col: 0 }, 2)).toThrow();
  });

  it('rejects moves once the game has ended', () => {
    let state = newGame();
    for (let col = 0; col < 4; col += 1) {
      state = applyMove(state, { row: 0, col }, 1);
      state = applyMove(state, { row: 1, col }, 2);
    }
    state = applyMove(state, { row: 0, col: 4 }, 1);
    expect(state.winner).toBe(1);
    expect(() => applyMove(state, { row: 2, col: 2 }, 2)).toThrow();
  });

  it('does not declare a winner when the five is blocked at both ends (Caro rule)', () => {
    let state = newGame();
    state = applyMove(state, { row: 6, col: 1 }, 1);
    state = applyMove(state, { row: 6, col: 0 }, 2); // O blocks left end
    state = applyMove(state, { row: 6, col: 2 }, 1);
    state = applyMove(state, { row: 9, col: 0 }, 2); // filler, off row 6
    state = applyMove(state, { row: 6, col: 3 }, 1);
    state = applyMove(state, { row: 9, col: 1 }, 2); // filler, off row 6
    state = applyMove(state, { row: 6, col: 4 }, 1);
    state = applyMove(state, { row: 6, col: 6 }, 2); // O blocks right end
    state = applyMove(state, { row: 6, col: 5 }, 1); // completes X at cols 1-5, row 6

    expect(state.winner).toBeNull();
  });
});

describe('serializeState / deserializeState', () => {
  it('round-trips a game state through JSON', () => {
    let state = newGame();
    state = applyMove(state, { row: 7, col: 7 }, 1);
    state = applyMove(state, { row: 8, col: 8 }, 2);

    const roundTripped = deserializeState(serializeState(state));
    expect(roundTripped).toEqual(state);
  });
});
