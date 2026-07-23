/**
 * Pure, game-agnostic weighted-random helpers. No dependency on this
 * codebase's Board/Player/Move types — reusable outside Caro entirely.
 */

export interface DecayConfig {
  /** Decay rate used at moveCount = 0 (most exploratory). */
  startDecay: number;
  /** Floor the decay rate never goes below. */
  minDecay: number;
  /** Linear decrease in decay rate per move played. */
  stepDown: number;
}

/**
 * Geometric decay weight for a cell at the given distance from a
 * reference point. distance=1 always yields weight 1; larger distances
 * yield exponentially smaller weights as decayRate shrinks toward 0.
 */
export function distanceWeight(distance: number, decayRate: number): number {
  return decayRate ** (distance - 1);
}

/**
 * The decay rate to use for distanceWeight, given how many moves have
 * been played so far. Starts wide/exploratory and linearly sharpens
 * toward minDecay as the game matures.
 */
export function decayRateForMoveCount(moveCount: number, config: DecayConfig): number {
  return Math.max(config.minDecay, config.startDecay - config.stepDown * moveCount);
}

/**
 * Weighted random selection. `rng` defaults to Math.random but is
 * injectable so callers (tests, replay tooling) can get deterministic
 * picks from a fixed sequence.
 */
export function weightedPick<T>(
  items: readonly T[],
  weights: readonly number[],
  rng: () => number = Math.random
): T {
  if (items.length !== weights.length) {
    throw new Error("items and weights must have the same length");
  }
  if (items.length === 0) {
    throw new Error("cannot pick from an empty list");
  }

  const total = weights.reduce((sum, w) => sum + w, 0);
  let target = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    target -= weights[i];
    if (target < 0) {
      return items[i];
    }
  }
  return items[items.length - 1];
}

/**
 * Samples up to `count` distinct items via repeated weighted picks,
 * removing each picked item (and its weight) before the next draw.
 */
export function sampleWithoutReplacement<T>(
  items: readonly T[],
  weights: readonly number[],
  count: number,
  rng: () => number = Math.random
): T[] {
  const remainingItems = [...items];
  const remainingWeights = [...weights];
  const picked: T[] = [];

  while (picked.length < count && remainingItems.length > 0) {
    const choice = weightedPick(remainingItems, remainingWeights, rng);
    picked.push(choice);
    const index = remainingItems.indexOf(choice);
    remainingItems.splice(index, 1);
    remainingWeights.splice(index, 1);
  }

  return picked;
}
