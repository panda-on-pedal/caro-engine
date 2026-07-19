import type { Difficulty } from '../engine/engine.ts';

/** The tournament only rotates through these three difficulties — expert's
 * 10s budget is reserved for human-facing modes. */
export type TournamentDifficulty = 'easy' | 'medium' | 'hard';

/** Six ordered difficulty pairings the tournament rotates through. Order
 * matters — the first player in each pair has the opening-move advantage,
 * so hard→medium and medium→hard are tracked as distinct rows. */
export const PAIRINGS = [
  ['hard', 'medium'],
  ['medium', 'hard'],
  ['medium', 'easy'],
  ['easy', 'medium'],
  ['hard', 'easy'],
  ['easy', 'hard'],
] as const satisfies ReadonlyArray<readonly [TournamentDifficulty, TournamentDifficulty]>;

export function pairingAt(counter: number): (typeof PAIRINGS)[number] {
  return PAIRINGS[counter % PAIRINGS.length];
}

/** Per-difficulty search time budget for tournament (fast-mode) games —
 * much shorter than the human-facing defaults so many boards can run
 * concurrently without any single game dominating a worker slot. */
export const TOURNAMENT_TIME_BUDGET_MS: Record<TournamentDifficulty, number> = {
  easy: 250,
  medium: 500,
  hard: 1000,
};

export function sessionTabLabel(index: number, p1: Difficulty, p2: Difficulty, movesPlayed: number): string {
  return `B${index + 1}: ${p1}×${p2} · ${movesPlayed}`;
}
