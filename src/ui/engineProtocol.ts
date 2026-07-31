import type { Board, Player } from "../engine/board.ts";
import type { Move } from "../engine/state.ts";
import { resolveEngineSearchConfig, type Difficulty } from "../engine/engine.ts";
import type {
  ExperienceEntry,
  ExperienceMode,
  ExperienceTransform,
} from "../engine/experience/experience.ts";
import {
  DEFAULT_SETTLE_GIVE_UP_SEARCHES,
  EMPTY_POSITION_KEY,
  isUsableExperienceMove,
  isStrongExperienceHit,
} from "../engine/experience/experience.ts";
import { experienceKeyFor, tryUseExperienceHit } from "../engine/experience/experienceLookup.ts";
import { PatternStore } from "../engine/patterns/patternStore.ts";
import type { NarrowSource } from "../engine/search/narrow.ts";
import {
  search,
  type PreparedRootMoves,
  type SearchParams,
  type SearchProgressEvent,
  type SearchResult,
} from "../engine/search/search.ts";
import { TranspositionTable, type TTEntry } from "../engine/transposition/transposition.ts";
import { PersistentExperienceStore } from "./experiencePersist.ts";
import { loadSlice as realLoadSlice, flushSlice as realFlushSlice } from "./ttPersist.ts";
import { logger } from "../utils/logger.ts";

export type { SearchProgressEvent };

/** `PreparedRootMoves` without the live PatternStore — safe to postMessage. */
export type PreparedRootMovesWire = Omit<PreparedRootMoves, "store">;

export interface EngineRequest {
  id: number;
  board: Board;
  player: Player;
  difficulty: Difficulty;
  timeBudgetMs?: number;
  /** When false, skip own-stone time stepping (practice / background reinvest). */
  stepTimeByOwnStones?: boolean;
  experienceMode?: ExperienceMode;
  experienceBaseline?: ExperienceEntry;
  /** Parallel root-partition: this worker searches only these root moves. */
  rootCandidates?: Move[];
  /** Precomputed root from the main thread (narrow once). */
  preparedRoot?: PreparedRootMovesWire;
  /** Debug log tag for parallel workers (e.g. "worker #1"). */
  workerLabel?: string;
  /** Synced-depth parallel: search only this ID depth (with maxDepth). */
  minDepth?: number;
  /** Override difficulty maxDepth for this request. */
  maxDepth?: number;
  /** Background book-deepening job: deepen under full budget, persist the TT. */
  bookDeepening?: boolean;
  /** Experience canonical key naming the persisted TT slice. */
  canonicalKey?: string;
}

export type EngineResponse =
  { id: number; ok: true; result: SearchResult } | { id: number; ok: false; error: string };

export type EngineProgressMessage = {
  id: number;
  type: "progress";
  event: SearchProgressEvent;
};

/** Generic worker → main log line (any logger call, not search-specific). */
export type EngineLogMessage = {
  type: "log";
  level: "log" | "warn" | "error";
  args: unknown[];
};

export type EngineMessage = EngineResponse | EngineProgressMessage | EngineLogMessage;

export function isProgressMessage(message: EngineMessage): message is EngineProgressMessage {
  return "type" in message && message.type === "progress";
}

export function isLogMessage(message: EngineMessage): message is EngineLogMessage {
  return "type" in message && message.type === "log";
}

/**
 * Worker-local pattern cache. Workers are long-lived, so one store is kept
 * across requests and advanced by the stones the new board adds instead of
 * being rebuilt from scratch (a full `findPatterns` pair costs ~0.4s at
 * mid-game density). This is what a parallel fan-out needs most: the same
 * position is redispatched once per iterative-deepening depth, and the next
 * turn differs by one or two stones. A cold worker or a backwards jump
 * (undo, new game, a different board session) still pays a full rebuild.
 */
let cachedStore: PatternStore | null = null;

/** The worker's store, synced to `board`. Never aliases `board` itself —
 *  `fromBoard` / `resetFromBoard` / `place` all work on an internal copy. */
function storeForBoard(board: Board): PatternStore {
  if (cachedStore === null) {
    cachedStore = PatternStore.fromBoard(board);
  } else {
    cachedStore.syncToBoard(board);
  }
  // Nothing will ever undo past this position, and the frames pin pattern
  // arrays; drop them so a long game does not accumulate history.
  cachedStore.clearHistory();
  return cachedStore;
}

/** Drop the cached store (error recovery, and test isolation). */
export function resetStoreCache(): void {
  cachedStore = null;
}

/** Map a worker request onto `search` params (resolve difficulty profile once). */
export function searchParamsFromRequest(
  request: EngineRequest,
  extras?: Pick<
    SearchParams,
    "preparedRoot" | "onProgress" | "tt" | "onDepthComplete" | "patternStore"
  >
): SearchParams {
  return {
    board: request.board,
    player: request.player,
    ...resolveEngineSearchConfig({
      difficulty: request.difficulty,
      timeBudgetMs: request.timeBudgetMs,
      stepTimeByOwnStones: request.stepTimeByOwnStones,
      experienceMode: request.experienceMode,
      experienceBaseline: request.experienceBaseline,
      rootCandidates: request.rootCandidates,
      minDepth: request.minDepth,
      maxDepth: request.maxDepth,
      bookDeepening: request.bookDeepening,
    }),
    preparedRoot: extras?.preparedRoot,
    patternStore: extras?.patternStore,
    workerLabel: request.workerLabel,
    onProgress: extras?.onProgress,
    tt: extras?.tt,
    onDepthComplete: extras?.onDepthComplete,
  };
}

export function handleEngineRequest(
  request: EngineRequest,
  onProgress?: (event: SearchProgressEvent) => void
): EngineResponse {
  try {
    // Slices carry `rootCandidates` rather than a prepared root, so the store
    // has to be handed in directly too — that is the path a fan-out repeats
    // once per depth.
    const store = storeForBoard(request.board);
    const preparedRoot =
      request.preparedRoot !== undefined ? { ...request.preparedRoot, store } : undefined;
    const result = search(
      searchParamsFromRequest(request, { preparedRoot, patternStore: store, onProgress })
    );
    return { id: request.id, ok: true, result };
  } catch (error) {
    // The cache is shared by every later request on this worker; never keep a
    // store whose state we cannot account for.
    resetStoreCache();
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface BookDeepenDeps {
  loadSlice: (key: string) => Promise<Array<[bigint, TTEntry]>>;
  flushSlice: (key: string, dirty: Array<[bigint, TTEntry]>) => Promise<void>;
}

/** Background reinvest: seed the persisted TT slice, deepen the position under
 *  the full budget, flushing after each completed depth.
 *
 *  Deliberately does NOT use the worker's cached store: this function awaits
 *  before searching, so the worker can accept another request in between and
 *  two searches would end up mutating the same store. */
export async function runBookDeepening(
  request: EngineRequest,
  deps: BookDeepenDeps = {
    loadSlice: realLoadSlice,
    flushSlice: realFlushSlice,
  }
): Promise<EngineResponse> {
  const key = request.canonicalKey;
  if (key === undefined) {
    return {
      id: request.id,
      ok: false,
      error: "bookDeepening without canonicalKey",
    };
  }
  try {
    const tt = new TranspositionTable();
    tt.seed(await deps.loadSlice(key));
    const result = search(
      searchParamsFromRequest(request, {
        tt,
        onDepthComplete: (_depth, dirty) => {
          // Fire-and-forget: never block the synchronous search. Dexie serializes
          // bulkPuts; a terminate mid-flush loses only this depth. Do NOT await.
          void deps.flushSlice(key, dirty);
        },
      })
    );
    return { id: request.id, ok: true, result };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Shared by EnginePool: resolve instant use-hits and prepare worker baselines. */
export function prepareExperienceForRequest(params: {
  board: Board;
  player: Player;
  difficulty: Difficulty;
  experienceMode: ExperienceMode;
  store: PersistentExperienceStore;
  /** Practice only. Default true — re-search non-permanent hits to improve them. */
  practiceImprovement?: boolean;
  /** Give-up threshold; a hit whose stallCount >= this is permanent. */
  settleGiveUpSearches?: number;
  /** When set with a non-quiet rootSource, book moves outside this set are
   *  stale: no hit/baseline, difficulty-book key deleted. Quiet samples are
   *  RNG-based and must not invalidate the book. */
  rootMoves?: readonly Move[];
  rootSource?: NarrowSource;
}): {
  instant: SearchResult | null;
  baseline?: ExperienceEntry;
  permanent: boolean;
  key: string;
  transform: ExperienceTransform;
  /** True when a difficulty-book entry was dropped for not being in rootMoves. */
  staleDiscarded?: boolean;
} {
  const giveUp = params.settleGiveUpSearches ?? DEFAULT_SETTLE_GIVE_UP_SEARCHES;
  const { key, transform } = experienceKeyFor(params.board, params.player);
  // Openings (empty / single-stone) share EMPTY — never replay or seed them.
  if (key === EMPTY_POSITION_KEY) {
    return { instant: null, permanent: false, key, transform };
  }

  const gateRoot =
    params.rootMoves !== undefined &&
    params.rootSource !== undefined &&
    params.rootSource !== "quiet";
  const rootKeys = gateRoot ? new Set(params.rootMoves!.map(m => `${m.row},${m.col}`)) : null;
  const inRoot = (move: Move) => rootKeys === null || rootKeys.has(`${move.row},${move.col}`);

  // Shared human book wins over the per-difficulty book: any non-off mode
  // replays a legal human-win move instantly (true mimic) with no background
  // improvement. `permanent: true` + no baseline makes EnginePool skip the
  // reinvest path entirely. Stale vs today's candidates → skip (keep human key).
  if (params.experienceMode !== "off") {
    const humanStored = params.store.getHuman(key);
    const humanEntry =
      humanStored !== undefined
        ? { ...humanStored, move: transform.fromCanonical(humanStored.move) }
        : undefined;
    if (
      isStrongExperienceHit(humanEntry) &&
      isUsableExperienceMove(params.board, humanEntry) &&
      inRoot(humanEntry.move)
    ) {
      const instant: SearchResult = {
        move: humanEntry.move,
        score: humanEntry.score,
        depth: humanEntry.depth,
        principalVariation: [humanEntry.move],
        nodesVisited: 0,
        ...(params.experienceMode === "practice"
          ? { experienceCacheHit: true, experienceStreakEligible: true }
          : {}),
      };
      return { instant, permanent: true, key, transform };
    }
  }
  // Books are already split by difficulty in PersistentExperienceStore.
  const stored = params.store.get(params.difficulty, key);
  // Stored moves live in the canonical frame; project back to this board.
  const entry =
    stored !== undefined ? { ...stored, move: transform.fromCanonical(stored.move) } : undefined;

  if (entry !== undefined && rootKeys !== null && !inRoot(entry.move)) {
    params.store.delete(params.difficulty, key);
    logger.log("experience stale — discarded", {
      key,
      move: entry.move,
      difficulty: params.difficulty,
    });
    return { instant: null, permanent: false, key, transform, staleDiscarded: true };
  }

  const instant = tryUseExperienceHit({
    board: params.board,
    player: params.player,
    mode: params.experienceMode,
    entry,
    practiceImprovement: params.practiceImprovement,
    settleGiveUpSearches: giveUp,
  });
  // Any non-off mode seeds/floors the search on a usable hit; `use` mode
  // additionally replays it instantly while a background search improves it.
  const baseline =
    params.experienceMode !== "off" && isUsableExperienceMove(params.board, entry)
      ? entry
      : undefined;
  return {
    instant,
    baseline,
    permanent: (stored?.stallCount ?? 0) >= giveUp,
    key,
    transform,
  };
}
