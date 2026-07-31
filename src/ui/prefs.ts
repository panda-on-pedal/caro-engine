import type { Difficulty } from "../engine/engine.ts";
import { NEVER_GIVE_UP_SEARCHES } from "../engine/experience/experience.ts";
import { isLocale, type Locale } from "./i18n/index.ts";

/** Keyed by Difficulty so a new difficulty fails to compile until listed here. */
const DIFFICULTIES: Record<Difficulty, true> = {
  easy: true,
  medium: true,
  hard: true,
  expert: true,
};

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && Object.hasOwn(DIFFICULTIES, value);
}

/** Range the give-up setting offers; the maximum doubles as the default. */
export const MIN_SETTLE_GIVE_UP_SEARCHES = 1;
export const MAX_SETTLE_GIVE_UP_SEARCHES = 50;

export function clampSettleGiveUpSearches(value: number): number {
  return Math.min(
    MAX_SETTLE_GIVE_UP_SEARCHES,
    Math.max(MIN_SETTLE_GIVE_UP_SEARCHES, Math.round(value))
  );
}

export interface CaroSettings {
  highlightWhileThinking: boolean;
  /** AI strength for human-vs-AI games; persisted so it survives a reload. */
  difficulty: Difficulty;
  /** When true, human–AI games write new root experience entries. */
  experienceImprovement: boolean;
  /**
   * When true (default), practice re-searches cache hits to keep improving the
   * stored entry. When false, practice instant-replays every hit and skips
   * background improvement, so games reach the edge of the cache — and restart
   * — much faster.
   */
  practiceImprovement: boolean;
  /** Give-up threshold: freeze a position after this many consecutive
   *  non-improving searches. 1–50, default 50. Ignored while `neverGiveUp`
   *  is on, but kept so turning that off restores the chosen number. */
  settleGiveUpSearches: number;
  /** When true, positions never freeze — reinvest keeps improving them. */
  neverGiveUp: boolean;
  /** When true, show engine thought lines in the status detail panel. */
  showThoughts: boolean;
  lang: Locale;
}

export const DEFAULT_SETTINGS: CaroSettings = {
  highlightWhileThinking: false,
  difficulty: "hard",
  experienceImprovement: true,
  practiceImprovement: true,
  settleGiveUpSearches: MAX_SETTLE_GIVE_UP_SEARCHES,
  neverGiveUp: false,
  showThoughts: true,
  lang: "vi",
};

const STORAGE_KEY = "caro.settings";

export function loadSettings(): CaroSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_SETTINGS };
    }
    const record = parsed as Record<string, unknown>;
    return {
      highlightWhileThinking:
        typeof record.highlightWhileThinking === "boolean"
          ? record.highlightWhileThinking
          : DEFAULT_SETTINGS.highlightWhileThinking,
      difficulty: isDifficulty(record.difficulty)
        ? record.difficulty
        : DEFAULT_SETTINGS.difficulty,
      experienceImprovement:
        typeof record.experienceImprovement === "boolean"
          ? record.experienceImprovement
          : DEFAULT_SETTINGS.experienceImprovement,
      practiceImprovement:
        typeof record.practiceImprovement === "boolean"
          ? record.practiceImprovement
          : DEFAULT_SETTINGS.practiceImprovement,
      settleGiveUpSearches:
        typeof record.settleGiveUpSearches === "number" &&
        Number.isFinite(record.settleGiveUpSearches)
          ? clampSettleGiveUpSearches(record.settleGiveUpSearches)
          : DEFAULT_SETTINGS.settleGiveUpSearches,
      neverGiveUp:
        typeof record.neverGiveUp === "boolean"
          ? record.neverGiveUp
          : DEFAULT_SETTINGS.neverGiveUp,
      showThoughts:
        typeof record.showThoughts === "boolean"
          ? record.showThoughts
          : DEFAULT_SETTINGS.showThoughts,
      lang:
        typeof record.lang === "string" && isLocale(record.lang)
          ? record.lang
          : DEFAULT_SETTINGS.lang,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** The threshold to hand the engine: unreachable while "never give up" is on. */
export function effectiveGiveUpSearches(settings: CaroSettings): number {
  return settings.neverGiveUp ? NEVER_GIVE_UP_SEARCHES : settings.settleGiveUpSearches;
}

export function saveSettings(settings: CaroSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
