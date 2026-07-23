import { isLocale, type Locale } from "./i18n/index.ts";

export interface CaroSettings {
  highlightWhileThinking: boolean;
  /** When true, human–AI games write new root experience entries. */
  experienceImprovement: boolean;
  /** When true, show engine thought lines in the status detail panel. */
  showThoughts: boolean;
  lang: Locale;
}

export const DEFAULT_SETTINGS: CaroSettings = {
  highlightWhileThinking: false,
  experienceImprovement: true,
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
      experienceImprovement:
        typeof record.experienceImprovement === "boolean"
          ? record.experienceImprovement
          : DEFAULT_SETTINGS.experienceImprovement,
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

export function saveSettings(settings: CaroSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
