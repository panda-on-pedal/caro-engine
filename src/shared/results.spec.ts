// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { PAIRINGS, TOURNAMENT_DIFFICULTIES } from "../ui/tournament.ts";
import {
  aggregateResults,
  firstPlayerWinPct,
  isValidGameResult,
  playerLeaderboard,
  type GameResult,
} from "./results.ts";

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
  ])("rejects malformed record %#", bad => {
    expect(isValidGameResult(bad)).toBe(false);
  });
});

describe("aggregateResults", () => {
  it("returns one zero row per PAIRINGS entry in order, for empty input", () => {
    const stats = aggregateResults([]);
    expect(stats).toHaveLength(PAIRINGS.length);
    stats.forEach((row, i) => {
      expect(row.p1).toBe(PAIRINGS[i][0]);
      expect(row.p2).toBe(PAIRINGS[i][1]);
      expect(row).toMatchObject({
        games: 0,
        p1Wins: 0,
        p2Wins: 0,
        draws: 0,
        p1WinPct: 0,
        avgP1Moves: 0,
        avgP2Moves: 0,
      });
    });
  });

  it("tallies ordered pairings separately (hard×medium != medium×hard)", () => {
    const records: GameResult[] = [
      { p1: "hard", p2: "medium", winner: 1, moves: 10, durationMs: 100, endedAt: "t1" },
      { p1: "hard", p2: "medium", winner: 1, moves: 10, durationMs: 100, endedAt: "t2" },
      { p1: "medium", p2: "hard", winner: 2, moves: 10, durationMs: 100, endedAt: "t3" },
    ];
    const stats = aggregateResults(records);
    const hardMedium = stats.find(row => row.p1 === "hard" && row.p2 === "medium")!;
    const mediumHard = stats.find(row => row.p1 === "medium" && row.p2 === "hard")!;
    expect(hardMedium).toMatchObject({ games: 2, p1Wins: 2, p2Wins: 0, draws: 0, p1WinPct: 100 });
    expect(mediumHard).toMatchObject({ games: 1, p1Wins: 0, p2Wins: 1, draws: 0, p1WinPct: 0 });
  });

  it("handles draws", () => {
    const records: GameResult[] = [
      { p1: "easy", p2: "medium", winner: "draw", moves: 400, durationMs: 100, endedAt: "t1" },
    ];
    const stats = aggregateResults(records);
    const row = stats.find(r => r.p1 === "easy" && r.p2 === "medium")!;
    expect(row).toMatchObject({ games: 1, p1Wins: 0, p2Wins: 0, draws: 1, p1WinPct: 0 });
  });

  it("computes average moves per player, splitting an odd total toward player 1 (who always moves first)", () => {
    const records: GameResult[] = [
      { p1: "hard", p2: "easy", winner: 1, moves: 9, durationMs: 100, endedAt: "t1" },
      { p1: "hard", p2: "easy", winner: 2, moves: 20, durationMs: 100, endedAt: "t2" },
    ];
    const stats = aggregateResults(records);
    const row = stats.find(r => r.p1 === "hard" && r.p2 === "easy")!;
    // game 1: 9 moves -> p1 made 5, p2 made 4. game 2: 20 moves -> p1 made 10, p2 made 10.
    expect(row.avgP1Moves).toBeCloseTo((5 + 10) / 2);
    expect(row.avgP2Moves).toBeCloseTo((4 + 10) / 2);
  });
});

describe("firstPlayerWinPct", () => {
  it("returns null when there are no games", () => {
    expect(firstPlayerWinPct([])).toBeNull();
  });

  it("is P1 wins over all games (draws count against the rate)", () => {
    const records: GameResult[] = [
      { p1: "hard", p2: "easy", winner: 1, moves: 10, durationMs: 100, endedAt: "t1" },
      { p1: "easy", p2: "hard", winner: 2, moves: 10, durationMs: 100, endedAt: "t2" },
      { p1: "medium", p2: "hard", winner: "draw", moves: 400, durationMs: 100, endedAt: "t3" },
      { p1: "expert", p2: "hard", winner: 1, moves: 12, durationMs: 100, endedAt: "t4" },
    ];
    // 2 P1 wins out of 4 games
    expect(firstPlayerWinPct(records)).toBeCloseTo(50);
  });
});

describe("playerLeaderboard", () => {
  it("returns one zero row per difficulty when empty, in difficulty order", () => {
    const board = playerLeaderboard([]);
    expect(board.map(row => row.player)).toEqual([...TOURNAMENT_DIFFICULTIES]);
    for (const row of board) {
      expect(row).toMatchObject({ wins: 0, games: 0, winPct: 0 });
    }
  });

  it("counts wins and games across both seats; win% is wins/games", () => {
    const records: GameResult[] = [
      { p1: "hard", p2: "easy", winner: 1, moves: 10, durationMs: 100, endedAt: "t1" },
      { p1: "easy", p2: "hard", winner: 2, moves: 10, durationMs: 100, endedAt: "t2" },
      { p1: "hard", p2: "medium", winner: "draw", moves: 400, durationMs: 100, endedAt: "t3" },
      { p1: "medium", p2: "easy", winner: 1, moves: 12, durationMs: 100, endedAt: "t4" },
    ];
    const board = playerLeaderboard(records);
    const byPlayer = Object.fromEntries(board.map(row => [row.player, row]));

    // hard: played 3 (vs easy, vs easy, vs medium), won 2
    expect(byPlayer.hard).toMatchObject({ wins: 2, games: 3, winPct: (2 / 3) * 100 });
    // medium: played 2 (vs hard draw, vs easy win), won 1
    expect(byPlayer.medium).toMatchObject({ wins: 1, games: 2, winPct: 50 });
    // easy: played 3, won 0
    expect(byPlayer.easy).toMatchObject({ wins: 0, games: 3, winPct: 0 });
    // expert: played 0
    expect(byPlayer.expert).toMatchObject({ wins: 0, games: 0, winPct: 0 });
  });

  it("sorts by wins desc, then win% desc, then difficulty order", () => {
    const records: GameResult[] = [
      // hard: 2 wins / 2 games = 100%
      { p1: "hard", p2: "easy", winner: 1, moves: 10, durationMs: 100, endedAt: "t1" },
      { p1: "easy", p2: "hard", winner: 2, moves: 10, durationMs: 100, endedAt: "t2" },
      // medium: 1 win / 1 game = 100% (fewer wins than hard → after hard)
      { p1: "medium", p2: "easy", winner: 1, moves: 10, durationMs: 100, endedAt: "t3" },
      // expert: 1 win / 2 games = 50% (same wins as medium, lower % → after medium)
      { p1: "expert", p2: "easy", winner: 1, moves: 10, durationMs: 100, endedAt: "t4" },
      { p1: "easy", p2: "expert", winner: 1, moves: 10, durationMs: 100, endedAt: "t5" },
    ];
    expect(playerLeaderboard(records).map(row => row.player)).toEqual([
      "hard",
      "medium",
      "expert",
      "easy",
    ]);
  });
});
