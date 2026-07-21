import type { NarrowSource } from "./narrow.ts";

export interface TimeBudgetRampConfig {
  /** Stones below this use `minFraction` of max budget. */
  rampStart: number;
  /** Stones at/above this use 100% (unless already snapped by source). */
  rampFull: number;
  /** Fraction of max budget used before `rampStart`. */
  minFraction: number;
}

export const DEFAULT_TIME_BUDGET_RAMP: TimeBudgetRampConfig = {
  rampStart: 4,
  rampFull: 20,
  minFraction: 0.15,
};

/**
 * Hybrid time budget: ramp with stone count on quiet/soft positions;
 * snap to 100% of `maxBudgetMs` when narrowing is already tactical or forced.
 */
export function resolveEffectiveTimeBudget(params: {
  maxBudgetMs: number;
  moveCount: number;
  narrowSource: NarrowSource;
  ramp?: TimeBudgetRampConfig;
}): number {
  const ramp = params.ramp ?? DEFAULT_TIME_BUDGET_RAMP;
  if (params.narrowSource === "tactical" || params.narrowSource === "forced") {
    return params.maxBudgetMs;
  }

  const { rampStart, rampFull, minFraction } = ramp;
  if (params.moveCount < rampStart) {
    return Math.max(1, Math.round(params.maxBudgetMs * minFraction));
  }
  if (params.moveCount >= rampFull || rampFull <= rampStart) {
    return params.maxBudgetMs;
  }

  const t = (params.moveCount - rampStart) / (rampFull - rampStart);
  const fraction = minFraction + (1 - minFraction) * t;
  return Math.max(1, Math.round(params.maxBudgetMs * fraction));
}
