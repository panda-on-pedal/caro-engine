import {
  decayRateForMoveCount,
  distanceWeight,
  sampleWithoutReplacement,
  weightedPick,
} from "./randomize.ts";

describe("distanceWeight", () => {
  it("always returns 1 at distance 1, regardless of decay rate", () => {
    expect(distanceWeight(1, 0.8)).toBe(1);
    expect(distanceWeight(1, 0.1)).toBe(1);
  });

  it("decreases monotonically as distance increases", () => {
    const w1 = distanceWeight(1, 0.5);
    const w2 = distanceWeight(2, 0.5);
    const w3 = distanceWeight(3, 0.5);
    expect(w1).toBeGreaterThan(w2);
    expect(w2).toBeGreaterThan(w3);
  });

  it("matches the geometric decay formula exactly", () => {
    expect(distanceWeight(3, 0.5)).toBeCloseTo(0.25, 10);
  });

  it("collapses to near-zero weight for far cells at a low decay rate", () => {
    expect(distanceWeight(5, 0.1)).toBeCloseTo(0.0001, 10);
  });
});

describe("decayRateForMoveCount", () => {
  const config = { startDecay: 0.8, minDecay: 0.15, stepDown: 0.05 };

  it("returns startDecay at moveCount 0", () => {
    expect(decayRateForMoveCount(0, config)).toBeCloseTo(0.8, 10);
  });

  it("decreases as moveCount increases", () => {
    expect(decayRateForMoveCount(4, config)).toBeCloseTo(0.6, 10);
  });

  it("never goes below minDecay", () => {
    expect(decayRateForMoveCount(100, config)).toBe(0.15);
  });

  it("is monotonically non-increasing", () => {
    const a = decayRateForMoveCount(2, config);
    const b = decayRateForMoveCount(5, config);
    expect(b).toBeLessThanOrEqual(a);
  });
});

describe("weightedPick", () => {
  it("always picks the only item in a single-item list", () => {
    expect(weightedPick(["a"], [1])).toBe("a");
  });

  it("picks deterministically for an injected rng at the low end of the range", () => {
    // total weight = 3; rng() * 3 = 0 -> lands in the first item's slice
    const result = weightedPick(["a", "b", "c"], [1, 1, 1], () => 0);
    expect(result).toBe("a");
  });

  it("picks deterministically for an injected rng at the high end of the range", () => {
    // total weight = 3; rng() * 3 = 2.999... -> lands in the last item's slice
    const result = weightedPick(["a", "b", "c"], [1, 1, 1], () => 0.9999);
    expect(result).toBe("c");
  });

  it("never picks a zero-weight item when a positive-weight item is available", () => {
    const result = weightedPick(["a", "b"], [0, 1], () => 0.5);
    expect(result).toBe("b");
  });

  it("never picks a leading zero-weight item even at the exact rng()=0 boundary", () => {
    // Regression: a `target <= 0` check (instead of `target < 0`) lets the
    // very first item's zero-width interval "catch" target=0, wrongly
    // selecting a weight-0 item. rng()=0 is squarely inside Math.random()'s
    // real [0, 1) range, so this must route to the next positive-weight item.
    const result = weightedPick(["a", "b"], [0, 1], () => 0);
    expect(result).toBe("b");
  });

  it("throws when items and weights have different lengths", () => {
    expect(() => weightedPick(["a"], [1, 2])).toThrow();
  });

  it("throws when given an empty list", () => {
    expect(() => weightedPick([], [])).toThrow();
  });
});

describe("sampleWithoutReplacement", () => {
  it("returns all items when count exceeds the list length", () => {
    const result = sampleWithoutReplacement(["a", "b"], [1, 1], 5, () => 0);
    expect(result.sort()).toEqual(["a", "b"]);
  });

  it("returns exactly `count` distinct items when the list is larger", () => {
    const items = ["a", "b", "c", "d", "e"];
    const weights = [1, 1, 1, 1, 1];
    const result = sampleWithoutReplacement(items, weights, 3, () => 0.5);
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
  });

  it("never repeats an item across the sample", () => {
    const items = ["a", "b", "c"];
    const weights = [1, 1, 1];
    const result = sampleWithoutReplacement(items, weights, 3, () => 0);
    expect(new Set(result).size).toBe(3);
  });
});
