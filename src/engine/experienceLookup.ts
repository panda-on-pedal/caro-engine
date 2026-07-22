import type { Board, Player } from "./board.ts";
import {
  canonicalExperienceKey,
  isStrongExperienceHit,
  isUsableExperienceMove,
  type CanonicalPosition,
  type ExperienceEntry,
  type ExperienceMode,
} from "./experience.ts";
import type { SearchResult } from "./search.ts";

/**
 * Resolve a root experience hit for "use" mode: return a SearchResult when
 * the cached entry is strong enough and still legal.
 */
export function tryUseExperienceHit(params: {
  board: Board;
  player: Player;
  mode: ExperienceMode;
  entry: ExperienceEntry | undefined;
}): SearchResult | null {
  if (params.mode !== "use") {
    return null;
  }
  if (!isStrongExperienceHit(params.entry)) {
    return null;
  }
  if (!isUsableExperienceMove(params.board, params.entry)) {
    return null;
  }
  return {
    move: params.entry.move,
    score: params.entry.score,
    depth: params.entry.depth,
    principalVariation: [params.entry.move],
    nodesVisited: 0,
  };
}

export function experienceKeyFor(
  board: Board,
  player: Player,
): CanonicalPosition {
  return canonicalExperienceKey(board, player);
}
