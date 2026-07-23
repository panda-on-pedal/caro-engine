import type { Board, Player } from "../board.ts";
import {
  canonicalExperienceKey,
  isStrongExperienceHit,
  isUsableExperienceMove,
  type CanonicalPosition,
  type ExperienceEntry,
  type ExperienceMode,
} from "./experience.ts";
import type { SearchResult } from "../search/search.ts";

/**
 * Resolve a root experience hit for instant replay:
 * - `use` mode: any strong legal entry (background reinvest may still deepen it)
 * - `practice` mode: only when the entry is `settled` (a full-budget search
 *   already failed to beat it — no better result expected). When
 *   `practiceImprovement` is false the settled requirement is dropped: every
 *   strong hit replays instantly so games reach the edge of the cache faster.
 */
export function tryUseExperienceHit(params: {
  board: Board;
  player: Player;
  mode: ExperienceMode;
  entry: ExperienceEntry | undefined;
  /** Practice only. Default true — re-search unsettled hits to improve them. */
  practiceImprovement?: boolean;
}): SearchResult | null {
  if (params.mode === "off") {
    return null;
  }
  if (
    params.mode === "practice" &&
    params.practiceImprovement !== false &&
    params.entry?.settled !== true
  ) {
    return null;
  }
  if (params.mode !== "use" && params.mode !== "practice") {
    return null;
  }
  if (!isStrongExperienceHit(params.entry)) {
    return null;
  }
  if (!isUsableExperienceMove(params.board, params.entry)) {
    return null;
  }
  const result: SearchResult = {
    move: params.entry.move,
    score: params.entry.score,
    depth: params.entry.depth,
    principalVariation: [params.entry.move],
    nodesVisited: 0,
  };
  if (params.mode === "practice") {
    return {
      ...result,
      experienceCacheHit: true,
      experienceStreakEligible: true,
    };
  }
  return result;
}

export function experienceKeyFor(board: Board, player: Player): CanonicalPosition {
  return canonicalExperienceKey(board, player);
}
