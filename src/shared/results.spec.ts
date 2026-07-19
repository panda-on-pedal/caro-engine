import { PAIRINGS } from "../ui/tournament.ts";
import { aggregateResults, isValidGameResult, type GameResult } from "./results.ts";

describe("isValidGameResult", () => {
  const good: GameResult = {
    p1: "hard",
    p2: "medium",
    winner: 1,
    moves: 42,
    durationMs: 1234,
    endedAt: "2026-07-20T00:00:00.000Z",
  };

  it("accepts a well-formed record", () => {
    expect(isValidGameResult(good)).toBe(true);
  });

  it("accepts a draw", () => {
    expect(isValidGameResult({ ...good, winner: "draw" })).toBe(true);
  });

  it.each([
    { ...good, p1: "impossible" },
    { ...good, winner: 3 },
    { ...good, moves: "42" },
    { ...good, durationMs: "1234" },
    { ...good, endedAt: 123 },
    null,
    "not an object",
    42,
  ])("rejects malformed record %#", (bad) => {
    expect(isValidGameResult(bad)).toBe(false);
  });
});

describe("aggregateResults", () => {
  it("returns 6 zero rows, one per PAIRINGS entry in order, for empty input", () => {
    const stats = aggregateResults([]);
    expect(stats).toHaveLength(PAIRINGS.length);
    stats.forEach((row, i) => {
      expect(row.p1).toBe(PAIRINGS[i][0]);
      expect(row.p2).toBe(PAIRINGS[i][1]);
      expect(row).toMatchObject({ games: 0, p1Wins: 0, p2Wins: 0, draws: 0, p1WinPct: 0 });
    });
  });

  it("tallies ordered pairings separately (hard×medium != medium×hard)", () => {
    const records: GameResult[] = [
      { p1: "hard", p2: "medium", winner: 1, moves: 10, durationMs: 100, endedAt: "t1" },
      { p1: "hard", p2: "medium", winner: 1, moves: 10, durationMs: 100, endedAt: "t2" },
      { p1: "medium", p2: "hard", winner: 2, moves: 10, durationMs: 100, endedAt: "t3" },
    ];
    const stats = aggregateResults(records);
    const hardMedium = stats.find((row) => row.p1 === "hard" && row.p2 === "medium")!;
    const mediumHard = stats.find((row) => row.p1 === "medium" && row.p2 === "hard")!;
    expect(hardMedium).toMatchObject({ games: 2, p1Wins: 2, p2Wins: 0, draws: 0, p1WinPct: 100 });
    expect(mediumHard).toMatchObject({ games: 1, p1Wins: 0, p2Wins: 1, draws: 0, p1WinPct: 0 });
  });

  it("handles draws", () => {
    const records: GameResult[] = [
      { p1: "easy", p2: "medium", winner: "draw", moves: 400, durationMs: 100, endedAt: "t1" },
    ];
    const stats = aggregateResults(records);
    const row = stats.find((r) => r.p1 === "easy" && r.p2 === "medium")!;
    expect(row).toMatchObject({ games: 1, p1Wins: 0, p2Wins: 0, draws: 1, p1WinPct: 0 });
  });
});
