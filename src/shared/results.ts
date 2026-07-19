import type { Difficulty } from '../engine/engine.ts';
import { PAIRINGS } from '../ui/tournament.ts';

export interface GameResult {
  p1: Difficulty;
  p2: Difficulty;
  winner: 1 | 2 | 'draw';
  moves: number;
  durationMs: number;
  endedAt: string;
}

const DIFFICULTIES: ReadonlySet<string> = new Set(['easy', 'medium', 'hard', 'expert']);

export function isValidGameResult(value: unknown): value is GameResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.p1 === 'string' &&
    DIFFICULTIES.has(record.p1) &&
    typeof record.p2 === 'string' &&
    DIFFICULTIES.has(record.p2) &&
    (record.winner === 1 || record.winner === 2 || record.winner === 'draw') &&
    typeof record.moves === 'number' &&
    typeof record.durationMs === 'number' &&
    typeof record.endedAt === 'string'
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
    const matching = records.filter((record) => record.p1 === p1 && record.p2 === p2);
    const games = matching.length;
    const p1Wins = matching.filter((record) => record.winner === 1).length;
    const p2Wins = matching.filter((record) => record.winner === 2).length;
    const draws = matching.filter((record) => record.winner === 'draw').length;
    const p1WinPct = games === 0 ? 0 : (p1Wins / games) * 100;
    const avgP1Moves = average(matching.map((record) => Math.ceil(record.moves / 2)));
    const avgP2Moves = average(matching.map((record) => Math.floor(record.moves / 2)));
    return { p1, p2, games, p1Wins, p2Wins, draws, p1WinPct, avgP1Moves, avgP2Moves };
  });
}
