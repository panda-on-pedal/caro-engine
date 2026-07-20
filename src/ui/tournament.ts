import type { Difficulty } from '../engine/engine.ts';
import { t } from './i18n/index.ts';

/** Difficulties that compete in the tournament (full `Difficulty` set). */
export const TOURNAMENT_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;

export type TournamentDifficulty = (typeof TOURNAMENT_DIFFICULTIES)[number];

/** All ordered pairings (p1 ≠ p2). Order matters — first player has the
 * opening-move advantage, so hard→medium and medium→hard are distinct rows.
 * Expert (arena) meets every other difficulty in both seatings. */
export const PAIRINGS: ReadonlyArray<readonly [TournamentDifficulty, TournamentDifficulty]> =
  buildOrderedPairings(TOURNAMENT_DIFFICULTIES);

function buildOrderedPairings(
  difficulties: readonly TournamentDifficulty[],
): ReadonlyArray<readonly [TournamentDifficulty, TournamentDifficulty]> {
  const pairings: Array<readonly [TournamentDifficulty, TournamentDifficulty]> = [];
  for (let i = 0; i < difficulties.length; i += 1) {
    for (let j = 0; j < difficulties.length; j += 1) {
      if (i === j) {
        continue;
      }
      pairings.push([difficulties[i], difficulties[j]]);
    }
  }
  return pairings;
}

export function pairingAt(counter: number): (typeof PAIRINGS)[number] {
  return PAIRINGS[counter % PAIRINGS.length];
}

/** Preferred default when the machine has enough cores; clamped to
 * `maxTournamentBoards(cores)` when populating the board-count select. */
export const DEFAULT_TOURNAMENT_BOARD_COUNT = 2;

/** Max simultaneous tournament boards (= worker pool size). Leaves one
 * core for the UI thread so the page stays interactive while games run. */
export function maxTournamentBoards(cores: number): number {
  return Math.max(1, cores - 1);
}

export function sessionTabLabel(index: number, p1: Difficulty, p2: Difficulty, movesPlayed: number): string {
  return t('tabs.board', { n: index + 1, p1, p2, moves: movesPlayed });
}
