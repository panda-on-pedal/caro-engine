import { search, type SearchConfig, type SearchResult } from "./search.ts";
import { DEFAULT_DECAY_CONFIG } from "./search.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  type ForkPatternName,
} from "./narrow.ts";
import type { ExperienceEntry, ExperienceMode } from "./experience.ts";
import type { GameState } from "./state.ts";

export type Difficulty = "easy" | "medium" | "hard" | "expert";

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
    timeBudgetMs: 500,
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
  /** Override the difficulty's default root-score jitter (0 disables). */
  rootScoreJitter?: number;
  /** When false, use `timeBudgetMs` as a hard cap (no move-count ramp). */
  adaptiveTimeBudget?: boolean;
  experienceMode?: ExperienceMode;
  experienceBaseline?: ExperienceEntry;
}

const DEFAULT_CONFIG: EngineConfig = { difficulty: "medium" };

/** Merge a difficulty profile with optional per-call overrides. */
export function resolveEngineSearchConfig(config: EngineConfig): SearchConfig {
  const profile = DIFFICULTY_PROFILES[config.difficulty];
  return {
    maxDepth: profile.maxDepth,
    timeBudgetMs: config.timeBudgetMs ?? profile.timeBudgetMs,
    recognizedForkPatterns: profile.recognizedForkPatterns,
    decay: DEFAULT_DECAY_CONFIG,
    rootScoreJitter: config.rootScoreJitter ?? profile.rootScoreJitter,
    adaptiveTimeBudget: config.adaptiveTimeBudget,
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
