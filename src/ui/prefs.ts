export interface CaroSettings {
  highlightWhileThinking: boolean;
}

export const DEFAULT_SETTINGS: CaroSettings = {
  highlightWhileThinking: true,
};

const STORAGE_KEY = 'caro.settings';

export function loadSettings(): CaroSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }
    const record = parsed as Record<string, unknown>;
    return {
      highlightWhileThinking:
        typeof record.highlightWhileThinking === 'boolean'
          ? record.highlightWhileThinking
          : DEFAULT_SETTINGS.highlightWhileThinking,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: CaroSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
