import type { Board, Player } from "./board.ts";
import { isLegalMove } from "./board.ts";
import type { Move } from "./state.ts";

export type ExperienceMode = "use" | "practice" | "off";

export interface ExperienceEntry {
  move: Move;
  score: number;
  depth: number;
}

export interface StoredExperienceEntry extends ExperienceEntry {
  key: string;
  updatedAt: number;
}

/** Stable root-position key: side to move + full board occupancy. */
export function experiencePositionKey(board: Board, sideToMove: Player): string {
  const rows: string[] = [];
  for (let r = 0; r < board.length; r += 1) {
    rows.push(board[r].join(""));
  }
  return `${sideToMove}|${rows.join("/")}`;
}

export function isStrongExperienceHit(
  entry: ExperienceEntry | undefined,
  plannedDepth: number,
): entry is ExperienceEntry {
  return entry !== undefined && entry.depth >= plannedDepth;
}

export function experienceBeatsBaseline(
  candidate: ExperienceEntry,
  baseline: ExperienceEntry,
): boolean {
  if (candidate.depth > baseline.depth) {
    return true;
  }
  if (candidate.depth === baseline.depth && candidate.score > baseline.score) {
    return true;
  }
  return false;
}

/** Prefer deeper entries; at equal depth prefer higher score. */
export function shouldReplaceExperience(
  existing: ExperienceEntry | undefined,
  next: ExperienceEntry,
): boolean {
  if (existing === undefined) {
    return true;
  }
  return experienceBeatsBaseline(next, existing) || (
    next.depth === existing.depth && next.score === existing.score
  );
}

export function isUsableExperienceMove(
  board: Board,
  entry: ExperienceEntry | undefined,
): entry is ExperienceEntry {
  if (entry === undefined) {
    return false;
  }
  return isLegalMove(board, entry.move.row, entry.move.col);
}

/**
 * In-memory LRU experience book. Persistence adapters serialize `entries()`.
 */
export class ExperienceStore {
  private readonly maxEntries: number;
  private readonly map = new Map<string, StoredExperienceEntry>();

  constructor(maxEntries = 2000) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    return this.map.size;
  }

  get(key: string): ExperienceEntry | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) {
      return undefined;
    }
    // LRU bump
    this.map.delete(key);
    this.map.set(key, entry);
    return { move: entry.move, score: entry.score, depth: entry.depth };
  }

  put(key: string, entry: ExperienceEntry, updatedAt = Date.now()): boolean {
    const existing = this.map.get(key);
    if (
      existing !== undefined &&
      !shouldReplaceExperience(existing, entry)
    ) {
      return false;
    }
    this.map.delete(key);
    this.map.set(key, {
      key,
      move: entry.move,
      score: entry.score,
      depth: entry.depth,
      updatedAt,
    });
    this.evictIfNeeded();
    return true;
  }

  /** Load entries (oldest first). Invalid rows are skipped. */
  loadAll(entries: readonly StoredExperienceEntry[]): void {
    this.map.clear();
    for (const entry of entries) {
      if (!isStoredEntry(entry)) {
        continue;
      }
      this.map.set(entry.key, {
        key: entry.key,
        move: { row: entry.move.row, col: entry.move.col },
        score: entry.score,
        depth: entry.depth,
        updatedAt: entry.updatedAt,
      });
    }
    this.evictIfNeeded();
  }

  /** Snapshot in LRU order (oldest → newest). */
  entries(): StoredExperienceEntry[] {
    return [...this.map.values()].map((entry) => ({
      key: entry.key,
      move: { row: entry.move.row, col: entry.move.col },
      score: entry.score,
      depth: entry.depth,
      updatedAt: entry.updatedAt,
    }));
  }

  clear(): void {
    this.map.clear();
  }

  private evictIfNeeded(): void {
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.map.delete(oldest);
    }
  }
}

function isStoredEntry(value: unknown): value is StoredExperienceEntry {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const row = value as StoredExperienceEntry;
  return (
    typeof row.key === "string" &&
    typeof row.score === "number" &&
    typeof row.depth === "number" &&
    typeof row.updatedAt === "number" &&
    row.move !== null &&
    typeof row.move === "object" &&
    typeof row.move.row === "number" &&
    typeof row.move.col === "number"
  );
}
