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

  // A "four" or "open-four" for the mover is an unstoppable win: the mover
  // gets to act right now and simply plays the completing cell before the
  // opponent gets a turn, regardless of how much material the opponent has
  // built up. Without this short-circuit, a large opponent open-four
  // (scored flat at PATTERN_SCORES["open-four"], no tempo discount) could
  // outweigh the mover's own tempo-multiplied four in the net sum below,
  // making the search blind to the fact that the opponent's threat never
  // gets a chance to materialize because the mover already won.
  if (
    moverPatterns.some((p) => p.type === "four" || p.type === "open-four")
  ) {
    return WIN_SCORE;
  }

  return (
    scorePatterns(moverPatterns, true) - scorePatterns(opponentPatterns, false)
  );
}
