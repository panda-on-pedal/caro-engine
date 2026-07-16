import { decayRateForMoveCount, distanceWeight } from "./randomize.ts";

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
