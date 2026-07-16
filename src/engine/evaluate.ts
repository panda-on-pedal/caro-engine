import type { Board, Player } from "./board.ts";
import {
  findPatterns,
  type PatternInstance,
  type PatternType,
} from "./patterns.ts";

export const PATTERN_SCORES: Record<PatternType, number> = {
  five: 1_000_000,
  "open-four": 100_000,
  four: 10_000,
  "open-three": 5_000,
  three: 500,
  "open-two": 100,
  two: 10,
};

export const TEMPO_MULTIPLIER = 1.2;
export const WIN_SCORE = 10_000_000;

function scorePatterns(patterns: PatternInstance[], isMover: boolean): number {
  const total = patterns.reduce((sum, p) => sum + PATTERN_SCORES[p.type], 0);
  return isMover ? total * TEMPO_MULTIPLIER : total;
}

/**
 * Sums pattern scores for both sides, giving the side to move a tempo
 * bonus (a four for the mover is a win next turn). Terminal positions
 * (a five already on the board) short-circuit to +/- WIN_SCORE.
 */
export function evaluate(board: Board, playerToMove: Player): number {
  const opponent: Player = playerToMove === 1 ? 2 : 1;

  const moverPatterns = findPatterns(board, playerToMove);
  const opponentPatterns = findPatterns(board, opponent);

  if (moverPatterns.some((p) => p.type === "five")) {
    return WIN_SCORE;
  }
  if (opponentPatterns.some((p) => p.type === "five")) {
    return -WIN_SCORE;
  }

  return (
    scorePatterns(moverPatterns, true) - scorePatterns(opponentPatterns, false)
  );
}
