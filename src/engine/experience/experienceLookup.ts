import type { Board, Player } from "../board.ts";
import { createEmptyBoard } from "../board.ts";
import {
  canonicalExperienceKey,
  DEFAULT_SETTLE_GIVE_UP_SEARCHES,
  isStrongExperienceHit,
  isUsableExperienceMove,
  EMPTY_POSITION_KEY,
  type CanonicalPosition,
  type ExperienceEntry,
  type ExperienceMode,
} from "./experience.ts";
import type { Move } from "../state.ts";
import type { SearchResult } from "../search/search.ts";

/**
 * Resolve a root experience hit for instant replay:
 * - `use` mode: any strong legal entry (background reinvest may still deepen it)
 * - `practice` mode: only when the entry is permanent (`stallCount` has reached
 *   the give-up threshold — no better result expected). When
 *   `practiceImprovement` is false the permanent requirement is dropped: every
 *   strong hit replays instantly so games reach the edge of the cache faster.
 */
export function tryUseExperienceHit(params: {
  board: Board;
  player: Player;
  mode: ExperienceMode;
  entry: ExperienceEntry | undefined;
  /** Practice only. Default true — re-search non-permanent hits to improve them. */
  practiceImprovement?: boolean;
  /** Give-up threshold; a hit whose stallCount >= this replays instantly. */
  settleGiveUpSearches?: number;
}): SearchResult | null {
  if (params.mode === "off") {
    return null;
  }
  const giveUp = params.settleGiveUpSearches ?? DEFAULT_SETTLE_GIVE_UP_SEARCHES;
  if (
    params.mode === "practice" &&
    params.practiceImprovement !== false &&
    (params.entry?.stallCount ?? 0) < giveUp
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

export interface HumanBookEntry {
  key: string;
  /** Winning human move, in the canonical frame of `key`. */
  move: Move;
}

/**
 * Walk a finished game's move list and return the canonical (key, move) pairs
 * for every move the human made — used to seed the shared human book after a
 * human win. Player 1 always moves on even indices, so `humanPlayer` selects
 * moves by parity. The empty-board opening (no shape to key) is skipped.
 */
export function humanWinBookEntries(
  moveHistory: readonly Move[],
  humanPlayer: Player
): HumanBookEntry[] {
  const board: Board = createEmptyBoard();
  const entries: HumanBookEntry[] = [];
  for (let i = 0; i < moveHistory.length; i += 1) {
    const mover: Player = i % 2 === 0 ? 1 : 2;
    const move = moveHistory[i];
    if (mover === humanPlayer) {
      const { key, transform } = canonicalExperienceKey(board, humanPlayer);
      if (key !== EMPTY_POSITION_KEY) {
        entries.push({ key, move: transform.toCanonical(move) });
      }
    }
    board[move.row][move.col] = mover;
  }
  return entries;
}
