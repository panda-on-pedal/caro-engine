// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import {
  DEFAULT_TOURNAMENT_BOARD_COUNT,
  maxTournamentBoards,
  nextCacheMissStreak,
  PAIRINGS,
  pairingAt,
  PRACTICE_CACHE_MISS_STREAK_LIMIT,
  PRACTICE_RESTART_MIN_STONES,
  sessionTabLabel,
  shouldRestartPracticeGame,
  TOURNAMENT_DIFFICULTIES,
} from "./tournament.ts";

describe("PAIRINGS", () => {
  it("is every ordered pair among tournament difficulties", () => {
    expect(PAIRINGS).toHaveLength(
      TOURNAMENT_DIFFICULTIES.length * (TOURNAMENT_DIFFICULTIES.length - 1)
    );
    for (const p1 of TOURNAMENT_DIFFICULTIES) {
      for (const p2 of TOURNAMENT_DIFFICULTIES) {
        if (p1 === p2) {
          expect(PAIRINGS.some(pair => pair[0] === p1 && pair[1] === p2)).toBe(false);
          continue;
        }
        expect(PAIRINGS.some(pair => pair[0] === p1 && pair[1] === p2)).toBe(true);
      }
    }
  });

  it("includes expert against every other difficulty in both seatings", () => {
    for (const other of TOURNAMENT_DIFFICULTIES) {
      if (other === "expert") {
        continue;
      }
      expect(PAIRINGS).toContainEqual(["expert", other]);
      expect(PAIRINGS).toContainEqual([other, "expert"]);
    }
  });
});

describe("pairingAt", () => {
  it("returns pairings in rotation order", () => {
    expect(pairingAt(0)).toEqual(PAIRINGS[0]);
    expect(pairingAt(1)).toEqual(PAIRINGS[1]);
    expect(pairingAt(PAIRINGS.length - 1)).toEqual(PAIRINGS[PAIRINGS.length - 1]);
  });

  it("wraps around across cycles", () => {
    expect(pairingAt(PAIRINGS.length)).toEqual(PAIRINGS[0]);
    expect(pairingAt(PAIRINGS.length + 1)).toEqual(PAIRINGS[1]);
  });
});

describe("maxTournamentBoards", () => {
  it("leaves one core free for the UI thread", () => {
    expect(maxTournamentBoards(4)).toBe(3);
    expect(maxTournamentBoards(8)).toBe(7);
  });

  it("never returns less than 1", () => {
    expect(maxTournamentBoards(1)).toBe(1);
    expect(maxTournamentBoards(0)).toBe(1);
  });

  it("keeps the default board count within the max for typical machines", () => {
    expect(DEFAULT_TOURNAMENT_BOARD_COUNT).toBeLessThanOrEqual(maxTournamentBoards(4));
  });
});

describe("sessionTabLabel", () => {
  it("formats a 1-indexed board label with pairing and move count", () => {
    expect(sessionTabLabel(0, "hard", "easy", 23)).toBe("B1: hard×easy · 23");
    expect(sessionTabLabel(3, "easy", "medium", 0)).toBe("B4: easy×medium · 0");
    expect(sessionTabLabel(1, "expert", "hard", 12)).toBe("B2: expert×hard · 12");
  });
});

describe("nextCacheMissStreak", () => {
  it("resets to 0 on a cache hit", () => {
    expect(nextCacheMissStreak(5, true, true)).toBe(0);
  });

  it("resets to 0 when there is no experience signal (non-practice search)", () => {
    expect(nextCacheMissStreak(5, undefined, undefined)).toBe(0);
  });

  it("resets to 0 when the ply is not streak-eligible (quiet / random)", () => {
    expect(nextCacheMissStreak(1, false, false)).toBe(0);
    expect(nextCacheMissStreak(1, false, undefined)).toBe(0);
  });

  it("increments only on an eligible cache miss", () => {
    expect(nextCacheMissStreak(0, false, true)).toBe(1);
    expect(nextCacheMissStreak(1, false, true)).toBe(2);
  });
});

describe("PRACTICE_CACHE_MISS_STREAK_LIMIT", () => {
  it("is two plies (P1 miss then P2 miss)", () => {
    expect(PRACTICE_CACHE_MISS_STREAK_LIMIT).toBe(2);
  });
});

describe("shouldRestartPracticeGame", () => {
  it("does not restart at or below the opening stone floor", () => {
    expect(
      shouldRestartPracticeGame({
        cacheMissStreak: PRACTICE_CACHE_MISS_STREAK_LIMIT,
        stoneCount: PRACTICE_RESTART_MIN_STONES,
      })
    ).toBe(false);
    expect(
      shouldRestartPracticeGame({
        cacheMissStreak: PRACTICE_CACHE_MISS_STREAK_LIMIT,
        stoneCount: 1,
      })
    ).toBe(false);
  });

  it("restarts only when streak and stone floor are both met", () => {
    expect(
      shouldRestartPracticeGame({
        cacheMissStreak: PRACTICE_CACHE_MISS_STREAK_LIMIT,
        stoneCount: PRACTICE_RESTART_MIN_STONES + 1,
      })
    ).toBe(true);
    expect(
      shouldRestartPracticeGame({
        cacheMissStreak: 1,
        stoneCount: 10,
      })
    ).toBe(false);
  });
});
