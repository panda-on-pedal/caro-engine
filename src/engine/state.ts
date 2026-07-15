import { checkWin, createEmptyBoard, isFull, isLegalMove, placeMove, type Board, type Player } from './board.ts';

export interface Move {
  row: number;
  col: number;
}

export type Winner = Player | 'draw' | null;

export interface GameState {
  board: Board;
  nextPlayer: Player;
  moveHistory: Move[];
  winner: Winner;
}

export function newGame(): GameState {
  return {
    board: createEmptyBoard(),
    nextPlayer: 1,
    moveHistory: [],
    winner: null,
  };
}

/** Applies `player`'s move to the state, returning the resulting state. Throws on illegal moves or moves made after the game has ended. */
export function applyMove(state: GameState, move: Move, player: Player): GameState {
  if (state.winner !== null) {
    throw new Error('Game has already ended');
  }
  if (player !== state.nextPlayer) {
    throw new Error(`It is not player ${player}'s turn`);
  }
  if (!isLegalMove(state.board, move.row, move.col)) {
    throw new Error(`Illegal move: (${move.row}, ${move.col})`);
  }

  const board = placeMove(state.board, move.row, move.col, player);
  const won = checkWin(board, move.row, move.col, player);
  const winner: Winner = won ? player : isFull(board) ? 'draw' : null;

  return {
    board,
    nextPlayer: player === 1 ? 2 : 1,
    moveHistory: [...state.moveHistory, move],
    winner,
  };
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state, null, 2);
}

export function deserializeState(json: string): GameState {
  return JSON.parse(json) as GameState;
}
