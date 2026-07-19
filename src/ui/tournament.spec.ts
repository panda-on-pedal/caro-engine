import { PAIRINGS, pairingAt, sessionTabLabel, TOURNAMENT_TIME_BUDGET_MS } from "./tournament.ts";

describe("PAIRINGS", () => {
  it("is exactly the 6 agreed ordered pairs, in order", () => {
    expect(PAIRINGS).toEqual([
      ["hard", "medium"],
      ["medium", "hard"],
      ["medium", "easy"],
      ["easy", "medium"],
      ["hard", "easy"],
      ["easy", "hard"],
    ]);
  });
});

describe("pairingAt", () => {
  it("returns pairings in rotation order", () => {
    expect(pairingAt(0)).toEqual(["hard", "medium"]);
    expect(pairingAt(1)).toEqual(["medium", "hard"]);
    expect(pairingAt(5)).toEqual(["easy", "hard"]);
  });

  it("wraps around across cycles", () => {
    expect(pairingAt(6)).toEqual(PAIRINGS[0]);
    expect(pairingAt(7)).toEqual(PAIRINGS[1]);
    expect(pairingAt(13)).toEqual(PAIRINGS[1]);
  });
});

describe("TOURNAMENT_TIME_BUDGET_MS", () => {
  it("defines a short budget for each non-expert difficulty", () => {
    expect(TOURNAMENT_TIME_BUDGET_MS).toEqual({ easy: 250, medium: 500, hard: 1000 });
  });
});

describe("sessionTabLabel", () => {
  it("formats a 1-indexed board label with pairing and move count", () => {
    expect(sessionTabLabel(0, "hard", "easy", 23)).toBe("B1: hard×easy · 23");
    expect(sessionTabLabel(3, "easy", "medium", 0)).toBe("B4: easy×medium · 0");
  });
});
