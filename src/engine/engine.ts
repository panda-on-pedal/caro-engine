import { BOARD_SIZE, isLegalMove, type Board } from './board.ts';
import type { GameState, Move } from './state.ts';

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

function findCandidateMoves(board: Board): Move[] {
  const candidates = new Map<string, Move>();
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] === 0) {
        continue;
      }
      for (const [dRow, dCol] of NEIGHBOR_OFFSETS) {
        const r = row + dRow;
        const c = col + dCol;
        if (isLegalMove(board, r, c)) {
          candidates.set(`${r},${c}`, { row: r, col: c });
        }
      }
    }
  }
  return [...candidates.values()];
}

function findAnyLegalMove(board: Board): Move {
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (isLegalMove(board, row, col)) {
        return { row, col };
      }
    }
  }
  throw new Error('No legal moves remain');
}

/**
 * Placeholder AI: plays the center on an empty board, otherwise a random
 * legal cell adjacent to an existing stone. This is the seam a real engine
 * (minimax/alpha-beta with heuristic evaluation) will replace.
 */
export function chooseMove(state: GameState): Move {
  if (state.moveHistory.length === 0) {
    const center = Math.floor(BOARD_SIZE / 2);
    return { row: center, col: center };
  }

  const candidates = findCandidateMoves(state.board);
  if (candidates.length === 0) {
    return findAnyLegalMove(state.board);
  }
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}
