// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { Board, Player } from "../board.ts";
import {
  findPatterns,
  type ForkPoint,
  type PatternInstance,
  type PatternType,
} from "../patterns/patterns.ts";

export const PATTERN_SCORES: Record<PatternType, number> = {
  five: 1_000_000,
  "open-four": 100_000,
  four: 10_000,
  "open-three": 5_000,
  three: 500,
  "open-two": 100,
  two: 10,
};

/** Tighter tier spread for `scoreMove` / fork bonus — same ordering intent as
 * `PATTERN_SCORES` but ~5× steps instead of 10–20× so forks and dual-purpose
 * moves can compete within the urgent tier. Leaf `evaluate()` keeps wide
 * `PATTERN_SCORES` + `WIN_SCORE` cliffs. */
export const RANK_PATTERN_WEIGHTS: Record<PatternType, number> = {
  five: 1_000_000,
  "open-four": 1_000,
  four: 500,
  "open-three": 250,
  three: 50,
  "open-two": 10,
  two: 2,
};

/** Global multiplier for proportional fork bonuses — tune here only. */
export const FORK_BONUS_SCALE = 3;

/** Sum of `RANK_PATTERN_WEIGHTS` over the fork's contributing lines × scale. */
export function forkBonusFor(forkPoint: ForkPoint): number {
  let total = 0;
  for (const pattern of forkPoint.patterns) {
    total += RANK_PATTERN_WEIGHTS[pattern.type];
  }
  return total * FORK_BONUS_SCALE;
}

export const TEMPO_MULTIPLIER = 1.2;
export const WIN_SCORE = 10_000_000;

function scorePatterns(patterns: readonly PatternInstance[], isMover: boolean): number {
  let total = 0;
  for (const p of patterns) {
    total += PATTERN_SCORES[p.type];
  }
  return isMover ? total * TEMPO_MULTIPLIER : total;
}

/**
 * Score from precomputed pattern lists (no board scan).
 */
export function evaluateFromPatterns(
  moverPatterns: readonly PatternInstance[],
  opponentPatterns: readonly PatternInstance[]
): number {
  if (moverPatterns.some(p => p.type === "five")) {
    return WIN_SCORE;
  }
  if (opponentPatterns.some(p => p.type === "five")) {
    return -WIN_SCORE;
  }

  // A "four" or "open-four" for the mover is an unstoppable win: the mover
  // gets to act right now and simply plays the completing cell before the
  // opponent gets a turn.
  if (moverPatterns.some(p => p.type === "four" || p.type === "open-four")) {
    return WIN_SCORE;
  }

  return scorePatterns(moverPatterns, true) - scorePatterns(opponentPatterns, false);
}

/**
 * Sums pattern scores for both sides, giving the side to move a tempo
 * bonus (a four for the mover is a win next turn). Terminal positions
 * (a five already on the board) short-circuit to +/- WIN_SCORE.
 */
export function evaluate(board: Board, playerToMove: Player): number {
  const opponent: Player = playerToMove === 1 ? 2 : 1;
  return evaluateFromPatterns(findPatterns(board, playerToMove), findPatterns(board, opponent));
}
