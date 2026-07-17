import { search, type SearchResult } from "./search.ts";
import { DEFAULT_DECAY_CONFIG } from "./search.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  type ForkPatternName,
} from "./narrow.ts";
import type { GameState } from "./state.ts";

export type Difficulty = "easy" | "medium" | "hard";

export interface EngineConfig {
  difficulty: Difficulty;
  timeBudgetMs?: number;
}

const DIFFICULTY_DEPTH: Record<Difficulty, number> = {
  easy: 2,
  medium: 4,
  hard: 6,
};

// Default per-difficulty time budgets, in milliseconds. These bound the cost
// of a single chooseMove call regardless of maxDepth, protecting against
// findPatterns' per-node rescan cost making deeper searches take an
// unreasonable amount of wall-clock time on the real 20x20 board. Callers
// that pass an explicit `timeBudgetMs` always override these defaults.
const DIFFICULTY_TIME_BUDGET_MS: Record<Difficulty, number> = {
  easy: 500,
  medium: 2000,
  hard: 5000,
};

// The line-pattern ladder (two -> five) is always fully recognized at
// every difficulty; only fork recognition is difficulty-gated. Medium
// recognizes the two most common/basic fork shapes; hard recognizes
// everything in the catalog (medium's two plus the rest).
const DIFFICULTY_FORK_PATTERNS: Record<
  Difficulty,
  ReadonlySet<ForkPatternName>
> = {
  easy: new Set(),
  medium: new Set(["double-three-trap", "double-four-trap"]),
  hard: ALL_FORK_PATTERN_NAMES,
};

const DEFAULT_CONFIG: EngineConfig = { difficulty: "medium" };

/**
 * Chooses the engine's next move for `state.nextPlayer`. Returns the full
 * SearchResult (not just the move) so callers can inspect score, depth
 * reached, and the principal variation for debugging or future bridging.
 */
export function chooseMove(
  state: GameState,
  config: EngineConfig = DEFAULT_CONFIG,
): SearchResult {
  const maxDepth = DIFFICULTY_DEPTH[config.difficulty];
  const timeBudgetMs =
    config.timeBudgetMs ?? DIFFICULTY_TIME_BUDGET_MS[config.difficulty];
  return search(state.board, state.nextPlayer, {
    maxDepth,
    timeBudgetMs,
    recognizedForkPatterns: DIFFICULTY_FORK_PATTERNS[config.difficulty],
    decay: DEFAULT_DECAY_CONFIG,
  });
}
