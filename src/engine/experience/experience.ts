import type { Board, Player } from "../board.ts";
import { isLegalMove, WIN_LENGTH } from "../board.ts";
import type { Move } from "../state.ts";

export type ExperienceMode = "use" | "practice" | "off";

/**
 * Key for positions with no tactical content worth booking: the empty board
 * and the single-stone opening reply. All mid-board single-stone shapes would
 * otherwise collapse onto one canonical key, so a single stored reply (e.g.
 * top-left of the stone) would lock every first-move answer forever.
 */
export const EMPTY_POSITION_KEY = "EMPTY";

/**
 * Minimum search depth an entry must carry to be trusted. Depth-0 entries come
 * from the quiet/fallback path (no real search) and are neither stored nor
 * replayed.
 */
export const MIN_EXPERIENCE_DEPTH = 1;

/** Default give-up threshold; user-overridable via settings. An entry whose
 *  `stallCount` reaches this is permanent (frozen — no further reinvest). */
export const DEFAULT_SETTLE_GIVE_UP_SEARCHES = 3;

export type SettleAction = "put" | "setStall" | "none";
export type SettleKind = "new" | "improved" | "stalled" | "settled";

export interface SettleTransition {
  action: SettleAction;
  /** Improvement counter after this transition (confidence; unbounded). */
  settleLevel: number;
  /** Consecutive non-improving searches after this transition (0..giveUp). */
  stallCount: number;
  /** True once stallCount has reached the give-up threshold. */
  permanent: boolean;
  emit: boolean;
  kind: SettleKind;
}

/**
 * Fold a fresh search result into a stored entry. `prev.move`/`cand.move` are
 * BOTH in the canonical frame. `giveUp` (>=1) is the give-up threshold: after
 * that many consecutive non-improving searches the entry freezes permanently.
 * - new entry            → put at settleLevel 0, stall 0
 * - beats baseline       → put at settleLevel prev+1, stall 0 (whether or not
 *                          the move changed — a deeper/better result is always
 *                          an upgrade, so settleLevel is monotonic with depth
 *                          and never resets at a given position)
 * - no improvement       → setStall: stall = prev+1 (permanent once >= giveUp),
 *                          keep the stored move/score/depth and settleLevel
 * - already permanent    → none (frozen for the session)
 * Any improvement resets the stall counter to 0.
 */
export function computeSettleTransition(
  prev: ExperienceEntry | undefined,
  cand: ExperienceEntry,
  giveUp: number
): SettleTransition {
  if (prev === undefined) {
    return {
      action: "put",
      settleLevel: 0,
      stallCount: 0,
      permanent: false,
      emit: true,
      kind: "new",
    };
  }
  const prevLevel = prev.settleLevel ?? 0;
  const prevStall = prev.stallCount ?? 0;
  if (prevStall >= giveUp) {
    return {
      action: "none",
      settleLevel: prevLevel,
      stallCount: prevStall,
      permanent: true,
      emit: false,
      kind: "settled",
    };
  }
  const beats = experienceBeatsBaseline(cand, prev);
  if (beats) {
    // Monotonic: any improvement (deeper, or equal-depth higher score) climbs
    // one level and resets the stall counter — a changed move on a deeper search
    // is an upgrade, not a confidence reset. `moveChanged` is still surfaced for
    // the report independently (computed at the emit site).
    return {
      action: "put",
      settleLevel: prevLevel + 1,
      stallCount: 0,
      permanent: false,
      emit: true,
      kind: "improved",
    };
  }
  const stallCount = prevStall + 1;
  const permanent = stallCount >= giveUp;
  return {
    action: "setStall",
    settleLevel: prevLevel,
    stallCount,
    permanent,
    emit: true,
    kind: permanent ? "settled" : "stalled",
  };
}

export interface ExperienceEntry {
  move: Move;
  score: number;
  depth: number;
  /** Improvement counter (confidence). Climbs +1 on every improvement (deeper,
   *  or equal-depth higher score) and never resets at a given position, so it is
   *  monotonic with depth. Unbounded. */
  settleLevel?: number;
  /** Consecutive non-improving searches since the last improvement. Reaching
   *  the give-up threshold freezes the entry permanently. */
  stallCount?: number;
  /** Total nodes the search that produced this entry visited (search work). */
  nodes?: number;
}

export interface StoredExperienceEntry extends ExperienceEntry {
  key: string;
  updatedAt: number;
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

export const IDENTITY_TRANSFORM: ExperienceTransform = {
  toCanonical: m => ({ row: m.row, col: m.col }),
  fromCanonical: m => ({ row: m.row, col: m.col }),
};

function makeTransform(
  sym: Symmetry,
  offRow: number,
  offCol: number,
  n: number
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
export function canonicalExperienceKey(board: Board, sideToMove: Player): CanonicalPosition {
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

  // Empty board and lone-stone replies: every quiet neighbor scores equally,
  // so booking one answer makes the engine repeat the same relative move.
  if (stones.length <= 1) {
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
      .map(p => `${p.r - minR},${p.c - minC},${p.owner}`)
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
 * Project every stone of `board` through `transform.toCanonical`, returning a
 * fresh board of the same size in the canonical frame. The background reinvest
 * searches this so its Zobrist hashes (and persisted TT slice) are identical
 * regardless of which symmetric orientation the position was encountered in.
 */
export function toCanonicalBoard(board: Board, transform: ExperienceTransform): Board {
  const n = board.length;
  const out: Board = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const cell = board[r][c];
      if (cell !== 0) {
        const { row, col } = transform.toCanonical({ row: r, col: c });
        out[row][col] = cell;
      }
    }
  }
  return out;
}

/**
 * An entry is replayable when it carries a real search (depth >= floor). We no
 * longer gate on the planned depth: under a time budget a fresh search reaches
 * roughly the same depth as the stored one, so re-searching a matched position
 * buys nothing.
 */
export function isStrongExperienceHit(
  entry: ExperienceEntry | undefined
): entry is ExperienceEntry {
  return entry !== undefined && entry.depth >= MIN_EXPERIENCE_DEPTH;
}

export function experienceBeatsBaseline(
  candidate: ExperienceEntry,
  baseline: ExperienceEntry
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
  next: ExperienceEntry
): boolean {
  if (existing === undefined) {
    return true;
  }
  return (
    experienceBeatsBaseline(next, existing) ||
    (next.depth === existing.depth && next.score === existing.score)
  );
}

export function isUsableExperienceMove(
  board: Board,
  entry: ExperienceEntry | undefined
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
  private onEvict?: (key: string) => void;

  constructor(maxEntries = 4000, onEvict?: (key: string) => void) {
    this.maxEntries = Math.max(1, maxEntries);
    this.onEvict = onEvict;
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
    return {
      move: entry.move,
      score: entry.score,
      depth: entry.depth,
      settleLevel: entry.settleLevel ?? 0,
      stallCount: entry.stallCount ?? 0,
      nodes: entry.nodes,
    };
  }

  put(key: string, entry: ExperienceEntry, updatedAt = Date.now()): boolean {
    const existing = this.map.get(key);
    if (existing !== undefined && !shouldReplaceExperience(existing, entry)) {
      return false;
    }
    this.map.delete(key);
    this.map.set(key, {
      key,
      move: entry.move,
      score: entry.score,
      depth: entry.depth,
      settleLevel: entry.settleLevel ?? 0,
      stallCount: entry.stallCount ?? 0,
      nodes: entry.nodes,
      updatedAt,
    });
    this.evictIfNeeded();
    return true;
  }

  /** Raise the stall counter on an existing entry without replacing
   *  move/score/depth/settleLevel. Returns false when the key is missing or
   *  the entry is already at/above `count` (monotonic). */
  setStallCount(key: string, count: number): boolean {
    const entry = this.map.get(key);
    if (entry === undefined || (entry.stallCount ?? 0) >= count) {
      return false;
    }
    entry.stallCount = count;
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
        settleLevel: typeof entry.settleLevel === "number" ? entry.settleLevel : 0,
        stallCount: typeof entry.stallCount === "number" ? entry.stallCount : 0,
        nodes: typeof entry.nodes === "number" ? entry.nodes : undefined,
        updatedAt: entry.updatedAt,
      });
    }
    this.evictIfNeeded();
  }

  /** Snapshot in LRU order (oldest → newest). */
  entries(): StoredExperienceEntry[] {
    return [...this.map.values()].map(entry => ({
      key: entry.key,
      move: { row: entry.move.row, col: entry.move.col },
      score: entry.score,
      depth: entry.depth,
      settleLevel: entry.settleLevel ?? 0,
      stallCount: entry.stallCount ?? 0,
      nodes: entry.nodes,
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
      this.onEvict?.(oldest);
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
    (row.settleLevel === undefined || typeof row.settleLevel === "number") &&
    (row.stallCount === undefined || typeof row.stallCount === "number") &&
    (row.nodes === undefined || typeof row.nodes === "number") &&
    row.move !== null &&
    typeof row.move === "object" &&
    typeof row.move.row === "number" &&
    typeof row.move.col === "number"
  );
}
