interface TimeBudgetStepConfig {
  /** Floor budget used before `startOwnStones` (and at the first step). */
  minBudgetMs: number;
  /** Extra ms added per own stone after `startOwnStones`. */
  stepMs: number;
  /** Own stones below this stay at `minBudgetMs`. */
  startOwnStones: number;
}

/**
 * Keep `minBudgetMs` in sync with `DIFFICULTY_PROFILES.easy.timeBudgetMs`
 * (engine.ts imports this constant).
 */
export const DEFAULT_MIN_TIME_BUDGET_MS = 500;

export const DEFAULT_TIME_BUDGET_STEP: TimeBudgetStepConfig = {
  minBudgetMs: DEFAULT_MIN_TIME_BUDGET_MS,
  stepMs: 500,
  startOwnStones: 2,
};

/**
 * Step time budget by the side-to-move's stone count toward `maxBudgetMs`.
 * `moveCount` is total stones; own stones ≈ floor(moveCount / 2) under
 * alternating play.
 */
export function resolveEffectiveTimeBudget(params: {
  maxBudgetMs: number;
  moveCount: number;
  step?: TimeBudgetStepConfig;
}): number {
  const step = params.step ?? DEFAULT_TIME_BUDGET_STEP;
  const ownStones = Math.floor(params.moveCount / 2);
  const raw =
    ownStones < step.startOwnStones
      ? step.minBudgetMs
      : step.minBudgetMs +
        (ownStones - step.startOwnStones) * step.stepMs;
  return Math.max(1, Math.min(params.maxBudgetMs, raw));
}
