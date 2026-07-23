import type { Difficulty } from "../engine/engine.ts";
import { t } from "./i18n/index.ts";

/** Difficulties that compete in the tournament (full `Difficulty` set). */
export const TOURNAMENT_DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;

export type TournamentDifficulty = (typeof TOURNAMENT_DIFFICULTIES)[number];

/** All ordered pairings (p1 ≠ p2). Order matters — first player has the
 * opening-move advantage, so hard→medium and medium→hard are distinct rows.
 * Expert (arena) meets every other difficulty in both seatings. */
export const PAIRINGS: ReadonlyArray<readonly [TournamentDifficulty, TournamentDifficulty]> =
  buildOrderedPairings(TOURNAMENT_DIFFICULTIES);

function buildOrderedPairings(
  difficulties: readonly TournamentDifficulty[]
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

export function sessionTabLabel(
  index: number,
  p1: Difficulty,
  p2: Difficulty,
  movesPlayed: number
): string {
  return t("tabs.board", { n: index + 1, p1, p2, moves: movesPlayed });
}

/** Practice-mode consecutive cache-miss counter. Increments only on an
 * eligible real-search miss; resets on a hit, a non-eligible ply
 * (quiet / random shortcut), or when the signal is absent. */
export function nextCacheMissStreak(
  current: number,
  experienceCacheHit: boolean | undefined,
  streakEligible: boolean | undefined
): number {
  if (streakEligible !== true) {
    return 0;
  }
  return experienceCacheHit === false ? current + 1 : 0;
}

/** Consecutive eligible cache-miss plies (practice mode only) before a
 * board may restart — P1 miss then P2 miss. */
export const PRACTICE_CACHE_MISS_STREAK_LIMIT = 2;

/** Minimum stones on the board before a practice cache-miss restart may
 * fire. Opening plies (≤ this many stones) always continue. */
export const PRACTICE_RESTART_MIN_STONES = 2;

/** Whether practice should abandon the current game for a fresh pairing. */
export function shouldRestartPracticeGame(params: {
  cacheMissStreak: number;
  stoneCount: number;
}): boolean {
  return (
    params.cacheMissStreak >= PRACTICE_CACHE_MISS_STREAK_LIMIT &&
    params.stoneCount > PRACTICE_RESTART_MIN_STONES
  );
}
