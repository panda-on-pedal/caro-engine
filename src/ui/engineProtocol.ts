import type { Board, Player } from '../engine/board.ts';
import { resolveEngineSearchConfig, type Difficulty } from '../engine/engine.ts';
import { search, type SearchResult } from '../engine/search.ts';

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

export function handleEngineRequest(request: EngineRequest): EngineResponse {
  try {
    const result = search(
      request.board,
      request.player,
      resolveEngineSearchConfig({ difficulty: request.difficulty, timeBudgetMs: request.timeBudgetMs }),
    );
    return { id: request.id, ok: true, result };
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
