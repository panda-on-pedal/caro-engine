import type { Board, Player } from '../engine/board.ts';
import { resolveEngineSearchConfig, type Difficulty } from '../engine/engine.ts';
import {
  search,
  type SearchProgressEvent,
  type SearchResult,
} from '../engine/search.ts';

export type { SearchProgressEvent };

export interface EngineRequest {
  id: number;
  board: Board;
  player: Player;
  difficulty: Difficulty;
  timeBudgetMs?: number;
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
