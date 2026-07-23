import type { Board, Player } from '../engine/board.ts';
import {
  resolveEngineSearchConfig,
  type Difficulty,
} from '../engine/engine.ts';
import type {
  ExperienceEntry,
  ExperienceMode,
  ExperienceTransform,
} from '../engine/experience/experience.ts';
import {
  experienceKeyFor,
  tryUseExperienceHit,
} from '../engine/experience/experienceLookup.ts';
import { isUsableExperienceMove } from '../engine/experience/experience.ts';
import {
  search,
  type SearchProgressEvent,
  type SearchResult,
} from '../engine/search/search.ts';
import { PersistentExperienceStore } from './experiencePersist.ts';

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
}

export type EngineResponse =
  | { id: number; ok: true; result: SearchResult }
  | { id: number; ok: false; error: string };

export type EngineProgressMessage = {
  id: number;
  type: 'progress';
  event: SearchProgressEvent;
};

export type EngineMessage = EngineResponse | EngineProgressMessage;

export function isProgressMessage(message: EngineMessage): message is EngineProgressMessage {
  return 'type' in message && message.type === 'progress';
}

export function handleEngineRequest(
  request: EngineRequest,
  onProgress?: (event: SearchProgressEvent) => void,
): EngineResponse {
  try {
    const result = search(
      request.board,
      request.player,
      {
        ...resolveEngineSearchConfig({
          difficulty: request.difficulty,
          timeBudgetMs: request.timeBudgetMs,
          stepTimeByOwnStones: request.stepTimeByOwnStones,
          experienceMode: request.experienceMode,
          experienceBaseline: request.experienceBaseline,
        }),
        onProgress,
      },
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
}): {
  instant: SearchResult | null;
  baseline?: ExperienceEntry;
  settled: boolean;
  key: string;
  transform: ExperienceTransform;
} {
  const { key, transform } = experienceKeyFor(params.board, params.player);
  // Books are already split by difficulty in PersistentExperienceStore.
  const stored = params.store.get(params.difficulty, key);
  // Stored moves live in the canonical frame; project back to this board.
  const entry =
    stored !== undefined
      ? { ...stored, move: transform.fromCanonical(stored.move) }
      : undefined;
  const instant = tryUseExperienceHit({
    board: params.board,
    player: params.player,
    mode: params.experienceMode,
    entry,
  });
  // Any non-off mode seeds/floors the search on a usable hit; `use` mode
  // additionally replays it instantly while a background search improves it.
  const baseline =
    params.experienceMode !== 'off' && isUsableExperienceMove(params.board, entry)
      ? entry
      : undefined;
  return { instant, baseline, settled: stored?.settled === true, key, transform };
}
