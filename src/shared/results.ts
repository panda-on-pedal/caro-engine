import type { Difficulty } from "../engine/engine.ts";
import { PAIRINGS, TOURNAMENT_DIFFICULTIES } from "../ui/tournament.ts";

export interface GameResult {
  p1: Difficulty;
  p2: Difficulty;
  winner: 1 | 2 | "draw";
  moves: number;
  durationMs: number;
  endedAt: string;
}

const DIFFICULTIES: ReadonlySet<string> = new Set(["easy", "medium", "hard", "expert"]);

export function isValidGameResult(value: unknown): value is GameResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.p1 === "string" &&
    DIFFICULTIES.has(record.p1) &&
    typeof record.p2 === "string" &&
    DIFFICULTIES.has(record.p2) &&
    (record.winner === 1 || record.winner === 2 || record.winner === "draw") &&
    typeof record.moves === "number" &&
    typeof record.durationMs === "number" &&
    typeof record.endedAt === "string"
  );
}

export interface PairingStats {
  p1: Difficulty;
  p2: Difficulty;
  games: number;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  p1WinPct: number;
  /** Average move count per player, per game (player 1 always moves first,
   * so on an odd-length game they made one more move than player 2). */
  avgP1Moves: number;
  avgP2Moves: number;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Tallies results per ordered pairing (hard×medium and medium×hard are
 * counted separately), always returning one row per `PAIRINGS` entry, in
 * order, even when a pairing has no games yet. */
export function aggregateResults(records: GameResult[]): PairingStats[] {
  return PAIRINGS.map(([p1, p2]) => {
    const matching = records.filter(record => record.p1 === p1 && record.p2 === p2);
    const games = matching.length;
    const p1Wins = matching.filter(record => record.winner === 1).length;
    const p2Wins = matching.filter(record => record.winner === 2).length;
    const draws = matching.filter(record => record.winner === "draw").length;
    const p1WinPct = games === 0 ? 0 : (p1Wins / games) * 100;
    const avgP1Moves = average(matching.map(record => Math.ceil(record.moves / 2)));
    const avgP2Moves = average(matching.map(record => Math.floor(record.moves / 2)));
    return { p1, p2, games, p1Wins, p2Wins, draws, p1WinPct, avgP1Moves, avgP2Moves };
  });
}

/** Overall first-seat win rate across every recorded game. Draws count in the
 * denominator. `null` when there are no games yet. */
export function firstPlayerWinPct(records: GameResult[]): number | null {
  if (records.length === 0) {
    return null;
  }
  const p1Wins = records.filter(record => record.winner === 1).length;
  return (p1Wins / records.length) * 100;
}

export interface PlayerLeaderboardRow {
  player: Difficulty;
  wins: number;
  games: number;
  winPct: number;
}

const DIFFICULTY_ORDER = new Map(
  TOURNAMENT_DIFFICULTIES.map((difficulty, index) => [difficulty, index])
);

/** Per-difficulty standings: wins (either seat) and win% = wins / games played.
 * Sorted by wins desc, then win% desc, then difficulty order. Always one row
 * per tournament difficulty. */
export function playerLeaderboard(records: GameResult[]): PlayerLeaderboardRow[] {
  const rows: PlayerLeaderboardRow[] = TOURNAMENT_DIFFICULTIES.map(player => {
    let wins = 0;
    let games = 0;
    for (const record of records) {
      if (record.p1 !== player && record.p2 !== player) {
        continue;
      }
      games += 1;
      if (
        (record.winner === 1 && record.p1 === player) ||
        (record.winner === 2 && record.p2 === player)
      ) {
        wins += 1;
      }
    }
    return { player, wins, games, winPct: games === 0 ? 0 : (wins / games) * 100 };
  });
  rows.sort((a, b) => {
    if (b.wins !== a.wins) {
      return b.wins - a.wins;
    }
    if (b.winPct !== a.winPct) {
      return b.winPct - a.winPct;
    }
    return (DIFFICULTY_ORDER.get(a.player) ?? 0) - (DIFFICULTY_ORDER.get(b.player) ?? 0);
  });
  return rows;
}
