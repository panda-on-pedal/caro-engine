import { search, type SearchConfig, type SearchResult } from "./search/search.ts";
import { DEFAULT_DECAY_CONFIG } from "./search/search.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  type ForkPatternName,
} from "./search/narrow.ts";
import type { ExperienceEntry, ExperienceMode } from "./experience/experience.ts";
import type { GameState } from "./state.ts";
import { DEFAULT_MIN_TIME_BUDGET_MS } from "./timeBudget.ts";

export type Difficulty = "easy" | "medium" | "hard" | "expert";

/** Depth ceiling for background book deepening — time budget is the real
 *  limiter; this only guards against pathological unbounded recursion. */
export const BOOK_MAX_DEPTH = 24;

export interface DifficultyProfile {
  maxDepth: number;
  timeBudgetMs: number;
  recognizedForkPatterns: ReadonlySet<ForkPatternName>;
  rootScoreJitter: number;
}

/**
 * Single source of truth for per-difficulty engine ability. Tune a level by
 * editing its object here — do not scatter parallel Record maps.
 */
export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    maxDepth: 2,
    timeBudgetMs: DEFAULT_MIN_TIME_BUDGET_MS,
    recognizedForkPatterns: new Set(),
    rootScoreJitter: 0.15,
  },
  medium: {
    maxDepth: 4,
    timeBudgetMs: 2000,
    recognizedForkPatterns: new Set([
      "double-three-trap",
      "double-four-trap",
    ]),
    rootScoreJitter: 0.1,
  },
  hard: {
    maxDepth: 6,
    timeBudgetMs: 5000,
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    rootScoreJitter: 0.05,
  },
  expert: {
    maxDepth: 6,
    timeBudgetMs: 10000,
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    rootScoreJitter: 0.02,
  },
};

export interface EngineConfig {
  difficulty: Difficulty;
  timeBudgetMs?: number;
  /**
   * When false, skip own-stone time stepping (practice / background reinvest).
   * Practice defaults to false when unset.
   */
  stepTimeByOwnStones?: boolean;
  /** Override the difficulty's default root-score jitter (0 disables). */
  rootScoreJitter?: number;
  experienceMode?: ExperienceMode;
  experienceBaseline?: ExperienceEntry;
  /** Background book deepening: use BOOK_MAX_DEPTH instead of difficulty maxDepth. */
  bookDeepening?: boolean;
}

const DEFAULT_CONFIG: EngineConfig = { difficulty: "medium" };

/** Merge a difficulty profile with optional per-call overrides. */
export function resolveEngineSearchConfig(config: EngineConfig): SearchConfig {
  const profile = DIFFICULTY_PROFILES[config.difficulty];
  return {
    maxDepth: config.bookDeepening ? BOOK_MAX_DEPTH : profile.maxDepth,
    timeBudgetMs: config.timeBudgetMs ?? profile.timeBudgetMs,
    // Practice has no human waiting — use the full difficulty budget.
    stepTimeByOwnStones:
      config.stepTimeByOwnStones ??
      (config.experienceMode === "practice" ? false : undefined),
    recognizedForkPatterns: profile.recognizedForkPatterns,
    decay: DEFAULT_DECAY_CONFIG,
    rootScoreJitter: config.rootScoreJitter ?? profile.rootScoreJitter,
    experienceMode: config.experienceMode,
    experienceBaseline: config.experienceBaseline,
  };
}

/**
 * Chooses the engine's next move for `state.nextPlayer`. Returns the full
 * SearchResult (not just the move) so callers can inspect score, depth
 * reached, and the principal variation for debugging or future bridging.
 */
export function chooseMove(
  state: GameState,
  config: EngineConfig = DEFAULT_CONFIG,
): SearchResult {
  return search(
    state.board,
    state.nextPlayer,
    resolveEngineSearchConfig(config),
  );
}
