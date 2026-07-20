import {
  DEFAULT_TOURNAMENT_BOARD_COUNT,
  maxTournamentBoards,
  PAIRINGS,
  pairingAt,
  sessionTabLabel,
  TOURNAMENT_DIFFICULTIES,
} from "./tournament.ts";

describe("PAIRINGS", () => {
  it("is every ordered pair among tournament difficulties", () => {
    expect(PAIRINGS).toHaveLength(TOURNAMENT_DIFFICULTIES.length * (TOURNAMENT_DIFFICULTIES.length - 1));
    for (const p1 of TOURNAMENT_DIFFICULTIES) {
      for (const p2 of TOURNAMENT_DIFFICULTIES) {
        if (p1 === p2) {
          expect(PAIRINGS.some((pair) => pair[0] === p1 && pair[1] === p2)).toBe(false);
          continue;
        }
        expect(PAIRINGS.some((pair) => pair[0] === p1 && pair[1] === p2)).toBe(true);
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
