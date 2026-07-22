import type { Board, Player } from '../engine/board.ts';
import {
  resolveEngineSearchConfig,
  type Difficulty,
} from '../engine/engine.ts';
import type {
  ExperienceEntry,
  ExperienceMode,
  ExperienceTransform,
} from '../engine/experience.ts';
import {
  experienceKeyFor,
  tryUseExperienceHit,
} from '../engine/experienceLookup.ts';
import {
  isUsableExperienceMove,
  namespaceExperienceKey,
} from '../engine/experience.ts';
import {
  search,
  type SearchProgressEvent,
  type SearchResult,
} from '../engine/search.ts';
import { PersistentExperienceStore } from './experiencePersist.ts';

export type { SearchProgressEvent };

export interface EngineRequest {
  id: number;
  board: Board;
  player: Player;
  difficulty: Difficulty;
  timeBudgetMs?: number;
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
  key: string;
  transform: ExperienceTransform;
} {
  const { key: shapeKey, transform } = experienceKeyFor(
    params.board,
    params.player,
  );
  // Keep each difficulty's learned moves in its own namespace.
  const key = namespaceExperienceKey(params.difficulty, shapeKey);
  const stored = params.store.get(key);
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
  const baseline =
    params.experienceMode === 'practice' && isUsableExperienceMove(params.board, entry)
      ? entry
      : undefined;
  return { instant, baseline, key, transform };
}
