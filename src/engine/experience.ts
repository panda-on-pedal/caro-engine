import type { Board, Player } from "./board.ts";
import { isLegalMove, WIN_LENGTH } from "./board.ts";
import type { Move } from "./state.ts";

export type ExperienceMode = "use" | "practice" | "off";

/** Key for the empty board — the opening move is not worth recording. */
export const EMPTY_POSITION_KEY = "EMPTY";

/**
 * Minimum search depth an entry must carry to be trusted. Depth-0 entries come
 * from the quiet/fallback path (no real search) and are neither stored nor
 * replayed.
 */
export const MIN_EXPERIENCE_DEPTH = 1;

export interface ExperienceEntry {
  move: Move;
  score: number;
  depth: number;
}

export interface StoredExperienceEntry extends ExperienceEntry {
  key: string;
  updatedAt: number;
}

/**
 * Namespace a shape key so difficulties keep separate books — we don't want a
 * move learned at one level served at another. The empty-board key is never
 * stored, so it is left unprefixed and the storage skip-guard still matches it.
 */
export function namespaceExperienceKey(
  namespace: string,
  shapeKey: string,
): string {
  return shapeKey === EMPTY_POSITION_KEY ? shapeKey : `${namespace}|${shapeKey}`;
}

/** Maps a move between real board coordinates and the canonical frame. */
export interface ExperienceTransform {
  toCanonical(move: Move): Move;
  fromCanonical(move: Move): Move;
}

export interface CanonicalPosition {
  key: string;
  transform: ExperienceTransform;
}

/**
 * Distance-to-wall beyond this can't affect a five-in-a-row, so it is clamped:
 * identical shapes far from every edge collapse onto one key regardless of
 * where they sit, while shapes touching a wall keep the wall in their key.
 */
const EDGE_CLAMP = WIN_LENGTH - 1;

type CoordMap = (r: number, c: number, n: number) => [number, number];

interface Symmetry {
  apply: CoordMap;
  invert: CoordMap;
}

/** The 8 board-aware dihedral symmetries (4 rotations x 2 reflections). */
const SYMMETRIES: readonly Symmetry[] = [
  { apply: (r, c) => [r, c], invert: (r, c) => [r, c] }, // identity
  { apply: (r, c, n) => [c, n - 1 - r], invert: (r, c, n) => [n - 1 - c, r] }, // rot90
  {
    apply: (r, c, n) => [n - 1 - r, n - 1 - c],
    invert: (r, c, n) => [n - 1 - r, n - 1 - c],
  }, // rot180
  { apply: (r, c, n) => [n - 1 - c, r], invert: (r, c, n) => [c, n - 1 - r] }, // rot270
  { apply: (r, c) => [c, r], invert: (r, c) => [c, r] }, // transpose
  {
    apply: (r, c, n) => [n - 1 - c, n - 1 - r],
    invert: (r, c, n) => [n - 1 - c, n - 1 - r],
  }, // anti-transpose
  { apply: (r, c, n) => [n - 1 - r, c], invert: (r, c, n) => [n - 1 - r, c] }, // flip rows
  { apply: (r, c, n) => [r, n - 1 - c], invert: (r, c, n) => [r, n - 1 - c] }, // flip cols
];

const IDENTITY_TRANSFORM: ExperienceTransform = {
  toCanonical: (m) => ({ row: m.row, col: m.col }),
  fromCanonical: (m) => ({ row: m.row, col: m.col }),
};

function makeTransform(
  sym: Symmetry,
  offRow: number,
  offCol: number,
  n: number,
): ExperienceTransform {
  return {
    toCanonical(move) {
      const [tr, tc] = sym.apply(move.row, move.col, n);
      return { row: tr - offRow, col: tc - offCol };
    },
    fromCanonical(move) {
      const [rr, rc] = sym.invert(move.row + offRow, move.col + offCol, n);
      return { row: rr, col: rc };
    },
  };
}

/**
 * Canonical shape key: collapses the 8 board symmetries, the two color
 * labelings (side to move is always "1"), and translation (edge-aware) so that
 * the same shape hits one entry no matter its orientation or position. Returns
 * the transform needed to store/replay a move in real board coordinates.
 */
export function canonicalExperienceKey(
  board: Board,
  sideToMove: Player,
): CanonicalPosition {
  const n = board.length;
  const stones: Array<{ r: number; c: number; owner: 1 | 2 }> = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const cell = board[r][c];
      if (cell !== 0) {
        stones.push({ r, c, owner: cell === sideToMove ? 1 : 2 });
      }
    }
  }

  if (stones.length === 0) {
    return { key: EMPTY_POSITION_KEY, transform: IDENTITY_TRANSFORM };
  }

  let bestKey = "";
  let bestSym: Symmetry = SYMMETRIES[0];
  let bestOffRow = 0;
  let bestOffCol = 0;

  for (const sym of SYMMETRIES) {
    let minR = Infinity;
    let minC = Infinity;
    let maxR = -Infinity;
    let maxC = -Infinity;
    const pts = stones.map(({ r, c, owner }) => {
      const [tr, tc] = sym.apply(r, c, n);
      if (tr < minR) minR = tr;
      if (tc < minC) minC = tc;
      if (tr > maxR) maxR = tr;
      if (tc > maxC) maxC = tc;
      return { r: tr, c: tc, owner };
    });
    const eTop = Math.min(minR, EDGE_CLAMP);
    const eRight = Math.min(n - 1 - maxC, EDGE_CLAMP);
    const eBottom = Math.min(n - 1 - maxR, EDGE_CLAMP);
    const eLeft = Math.min(minC, EDGE_CLAMP);
    const body = pts
      .map((p) => `${p.r - minR},${p.c - minC},${p.owner}`)
      .sort()
      .join(";");
    const key = `${body}#${eTop},${eRight},${eBottom},${eLeft}`;
    if (bestKey === "" || key < bestKey) {
      bestKey = key;
      bestSym = sym;
      bestOffRow = minR;
      bestOffCol = minC;
    }
  }

  return {
    key: bestKey,
    transform: makeTransform(bestSym, bestOffRow, bestOffCol, n),
  };
}

/**
 * An entry is replayable when it carries a real search (depth >= floor). We no
 * longer gate on the planned depth: under a time budget a fresh search reaches
 * roughly the same depth as the stored one, so re-searching a matched position
 * buys nothing.
 */
export function isStrongExperienceHit(
  entry: ExperienceEntry | undefined,
): entry is ExperienceEntry {
  return entry !== undefined && entry.depth >= MIN_EXPERIENCE_DEPTH;
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
