import {
  DEFAULT_TIME_BUDGET_RAMP,
  resolveEffectiveTimeBudget,
} from "./timeBudget.ts";

describe("resolveEffectiveTimeBudget", () => {
  const maxBudgetMs = 10000;

  it("snaps to 100% on tactical and forced sources", () => {
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs,
        moveCount: 0,
        narrowSource: "tactical",
      }),
    ).toBe(maxBudgetMs);
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs,
        moveCount: 2,
        narrowSource: "forced",
      }),
    ).toBe(maxBudgetMs);
  });

  it("uses minFraction before rampStart on quiet boards", () => {
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs,
        moveCount: 0,
        narrowSource: "quiet",
      }),
    ).toBe(Math.round(maxBudgetMs * DEFAULT_TIME_BUDGET_RAMP.minFraction));
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs,
        moveCount: 3,
        narrowSource: "quiet",
      }),
    ).toBe(Math.round(maxBudgetMs * DEFAULT_TIME_BUDGET_RAMP.minFraction));
  });

  it("reaches full budget at rampFull on quiet boards", () => {
    expect(
      resolveEffectiveTimeBudget({
        maxBudgetMs,
        moveCount: DEFAULT_TIME_BUDGET_RAMP.rampFull,
        narrowSource: "quiet",
      }),
    ).toBe(maxBudgetMs);
  });

  it("ramps linearly between start and full", () => {
    const mid = resolveEffectiveTimeBudget({
      maxBudgetMs,
      moveCount: 12,
      narrowSource: "quiet",
    });
    const low = resolveEffectiveTimeBudget({
      maxBudgetMs,
      moveCount: 4,
      narrowSource: "quiet",
    });
    expect(mid).toBeGreaterThan(low);
    expect(mid).toBeLessThan(maxBudgetMs);
  });
});
