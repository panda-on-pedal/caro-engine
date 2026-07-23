import type { Board, Player } from "../engine/board.ts";
import { resolveEngineSearchConfig, type Difficulty } from "../engine/engine.ts";
import type {
  ExperienceEntry,
  ExperienceMode,
  ExperienceTransform,
} from "../engine/experience/experience.ts";
import { experienceKeyFor, tryUseExperienceHit } from "../engine/experience/experienceLookup.ts";
import { isUsableExperienceMove, isStrongExperienceHit } from "../engine/experience/experience.ts";
import { search, type SearchProgressEvent, type SearchResult } from "../engine/search/search.ts";
import { TranspositionTable, type TTEntry } from "../engine/transposition/transposition.ts";
import { PersistentExperienceStore } from "./experiencePersist.ts";
import { loadSlice as realLoadSlice, flushSlice as realFlushSlice } from "./ttPersist.ts";

export type { SearchProgressEvent };

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
  /** Background book-deepening job: search the canonical board, persist the TT. */
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

export type EngineMessage = EngineResponse | EngineProgressMessage;

export function isProgressMessage(message: EngineMessage): message is EngineProgressMessage {
  return "type" in message && message.type === "progress";
}

export function handleEngineRequest(
  request: EngineRequest,
  onProgress?: (event: SearchProgressEvent) => void
): EngineResponse {
  try {
    const result = search(request.board, request.player, {
      ...resolveEngineSearchConfig({
        difficulty: request.difficulty,
        timeBudgetMs: request.timeBudgetMs,
        stepTimeByOwnStones: request.stepTimeByOwnStones,
        experienceMode: request.experienceMode,
        experienceBaseline: request.experienceBaseline,
      }),
      onProgress,
    });
    return { id: request.id, ok: true, result };
  } catch (error) {
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

/** Background reinvest: seed the persisted TT slice, deepen the canonical
 *  position under the full budget, flushing after each completed depth. */
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
    const result = search(request.board, request.player, {
      ...resolveEngineSearchConfig({
        difficulty: request.difficulty,
        timeBudgetMs: request.timeBudgetMs,
        stepTimeByOwnStones: false,
        bookDeepening: true,
        experienceMode: request.experienceMode,
        experienceBaseline: request.experienceBaseline,
      }),
      tt,
      onDepthComplete: (_depth, dirty) => {
        // Fire-and-forget: never block the synchronous search. Dexie serializes
        // bulkPuts; a terminate mid-flush loses only this depth. Do NOT await.
        void deps.flushSlice(key, dirty);
      },
    });
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
  /** Practice only. Default true — re-search unsettled hits to improve them. */
  practiceImprovement?: boolean;
}): {
  instant: SearchResult | null;
  baseline?: ExperienceEntry;
  settled: boolean;
  key: string;
  transform: ExperienceTransform;
} {
  const { key, transform } = experienceKeyFor(params.board, params.player);
  // Shared human book wins over the per-difficulty book: any non-off mode
  // replays a legal human-win move instantly (true mimic) with no background
  // improvement. `settled: true` + no baseline makes EnginePool skip the
  // reinvest path entirely.
  if (params.experienceMode !== "off") {
    const humanStored = params.store.getHuman(key);
    const humanEntry =
      humanStored !== undefined
        ? { ...humanStored, move: transform.fromCanonical(humanStored.move) }
        : undefined;
    if (isStrongExperienceHit(humanEntry) && isUsableExperienceMove(params.board, humanEntry)) {
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
      return { instant, settled: true, key, transform };
    }
  }
  // Books are already split by difficulty in PersistentExperienceStore.
  const stored = params.store.get(params.difficulty, key);
  // Stored moves live in the canonical frame; project back to this board.
  const entry =
    stored !== undefined ? { ...stored, move: transform.fromCanonical(stored.move) } : undefined;
  const instant = tryUseExperienceHit({
    board: params.board,
    player: params.player,
    mode: params.experienceMode,
    entry,
    practiceImprovement: params.practiceImprovement,
  });
  // Any non-off mode seeds/floors the search on a usable hit; `use` mode
  // additionally replays it instantly while a background search improves it.
  const baseline =
    params.experienceMode !== "off" && isUsableExperienceMove(params.board, entry)
      ? entry
      : undefined;
  return { instant, baseline, settled: stored?.settled === true, key, transform };
}
