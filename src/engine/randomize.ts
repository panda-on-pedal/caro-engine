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
export function decayRateForMoveCount(
  moveCount: number,
  config: DecayConfig,
): number {
  return Math.max(
    config.minDecay,
    config.startDecay - config.stepDown * moveCount,
  );
}
