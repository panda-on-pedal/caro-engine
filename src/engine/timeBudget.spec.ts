// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import {
  DEFAULT_MIN_TIME_BUDGET_MS,
  DEFAULT_TIME_BUDGET_STEP,
  resolveEffectiveTimeBudget,
} from "./timeBudget.ts";

describe("resolveEffectiveTimeBudget", () => {
  const maxBudgetMs = 10000;
  const { minBudgetMs, stepMs, startOwnStones } = DEFAULT_TIME_BUDGET_STEP;

  it("uses floor(moveCount / 2) as own stones", () => {
    // 4 total stones → 2 own → still at floor (startOwnStones)
    expect(resolveEffectiveTimeBudget({ maxBudgetMs, moveCount: 4 })).toBe(minBudgetMs);
    // 5 total → 2 own (same)
    expect(resolveEffectiveTimeBudget({ maxBudgetMs, moveCount: 5 })).toBe(minBudgetMs);
    // 6 total → 3 own → one step
    expect(resolveEffectiveTimeBudget({ maxBudgetMs, moveCount: 6 })).toBe(minBudgetMs + stepMs);
  });

  it("stays at minBudget before startOwnStones", () => {
    // 0–1 own (0–3 total)
    expect(resolveEffectiveTimeBudget({ maxBudgetMs, moveCount: 0 })).toBe(minBudgetMs);
    expect(resolveEffectiveTimeBudget({ maxBudgetMs, moveCount: 1 })).toBe(minBudgetMs);
    expect(resolveEffectiveTimeBudget({ maxBudgetMs, moveCount: 3 })).toBe(minBudgetMs);
  });

  it("starts stepping at startOwnStones", () => {
    // own == startOwnStones → total 4
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs,
        moveCount: startOwnStones * 2,
      })
    ).toBe(minBudgetMs);
    // own == startOwnStones + 1 → total 6
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs,
        moveCount: (startOwnStones + 1) * 2,
      })
    ).toBe(minBudgetMs + stepMs);
    // own == startOwnStones + 2 → total 8
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs,
        moveCount: (startOwnStones + 2) * 2,
      })
    ).toBe(minBudgetMs + 2 * stepMs);
  });

  it("caps at maxBudgetMs", () => {
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs,
        moveCount: 100,
      })
    ).toBe(maxBudgetMs);
  });

  it("never exceeds a tiny maxBudgetMs override", () => {
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs: 50,
        moveCount: 0,
      })
    ).toBe(50);
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs: 50,
        moveCount: 40,
      })
    ).toBe(50);
  });

  it("keeps default min in sync with easy profile constant", () => {
    expect(DEFAULT_MIN_TIME_BUDGET_MS).toBe(500);
    expect(minBudgetMs).toBe(DEFAULT_MIN_TIME_BUDGET_MS);
  });
});

describe("resolveEffectiveTimeBudget stepTimeByOwnStones", () => {
  it("uses the full maxBudgetMs when stepping is disabled", () => {
    // Opening moveCount would otherwise floor at 500.
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs: 10000,
        moveCount: 0,
        stepTimeByOwnStones: false,
      })
    ).toBe(10000);
  });
});
