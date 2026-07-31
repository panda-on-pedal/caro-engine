import { NEVER_GIVE_UP_SEARCHES } from "../engine/experience/experience.ts";
import {
  DEFAULT_SETTINGS,
  effectiveGiveUpSearches,
  loadSettings,
  saveSettings,
} from "./prefs.ts";

describe("prefs", () => {
  const original = globalThis.localStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem(key: string): string | null {
          return store[key] ?? null;
        },
        setItem(key: string, value: string): void {
          store[key] = value;
        },
        removeItem(key: string): void {
          delete store[key];
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original,
    });
  });

  it("defaults language to Vietnamese, thoughts on, and both improvements on", () => {
    expect(DEFAULT_SETTINGS.lang).toBe("vi");
    expect(DEFAULT_SETTINGS.showThoughts).toBe(true);
    expect(DEFAULT_SETTINGS.experienceImprovement).toBe(true);
    expect(DEFAULT_SETTINGS.practiceImprovement).toBe(true);
    expect(DEFAULT_SETTINGS.settleGiveUpSearches).toBe(50);
    expect(DEFAULT_SETTINGS.neverGiveUp).toBe(false);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips highlightWhileThinking, showThoughts, improvements, and lang", () => {
    saveSettings({
      highlightWhileThinking: false,
      difficulty: "hard",
      showThoughts: true,
      experienceImprovement: true,
      practiceImprovement: true,
      settleGiveUpSearches: 3,
      neverGiveUp: false,
      lang: "en",
    });
    expect(loadSettings()).toEqual({
      highlightWhileThinking: false,
      difficulty: "hard",
      showThoughts: true,
      experienceImprovement: true,
      practiceImprovement: true,
      settleGiveUpSearches: 3,
      neverGiveUp: false,
      lang: "en",
    });
    saveSettings({
      highlightWhileThinking: true,
      difficulty: "easy",
      showThoughts: false,
      experienceImprovement: false,
      practiceImprovement: false,
      settleGiveUpSearches: 5,
      neverGiveUp: true,
      lang: "vi",
    });
    expect(loadSettings()).toEqual({
      highlightWhileThinking: true,
      difficulty: "easy",
      showThoughts: false,
      experienceImprovement: false,
      practiceImprovement: false,
      settleGiveUpSearches: 5,
      neverGiveUp: true,
      lang: "vi",
    });
  });

  it("returns defaults for missing or corrupt storage", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    store["caro.settings"] = "{not-json";
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    store["caro.settings"] = JSON.stringify({ highlightWhileThinking: "yes", lang: "fr" });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("fills missing fields on older saved settings", () => {
    store["caro.settings"] = JSON.stringify({ highlightWhileThinking: false });
    expect(loadSettings()).toEqual({
      highlightWhileThinking: false,
      difficulty: "hard",
      showThoughts: true,
      experienceImprovement: true,
      practiceImprovement: true,
      settleGiveUpSearches: 50,
      neverGiveUp: false,
      lang: "vi",
    });
  });

  it("persists a chosen difficulty and rejects an unknown one", () => {
    expect(DEFAULT_SETTINGS.difficulty).toBe("hard");
    store["caro.settings"] = JSON.stringify({ difficulty: "expert" });
    expect(loadSettings().difficulty).toBe("expert");
    store["caro.settings"] = JSON.stringify({ difficulty: "godlike" });
    expect(loadSettings().difficulty).toBe("hard");
  });

  it("defaults settleGiveUpSearches to 50", () => {
    store = {};
    expect(loadSettings().settleGiveUpSearches).toBe(50);
  });

  it("clamps a persisted settleGiveUpSearches into 1..50", () => {
    store["caro.settings"] = JSON.stringify({ settleGiveUpSearches: 420 });
    expect(loadSettings().settleGiveUpSearches).toBe(50);
    store["caro.settings"] = JSON.stringify({ settleGiveUpSearches: 0 });
    expect(loadSettings().settleGiveUpSearches).toBe(1);
    store["caro.settings"] = JSON.stringify({ settleGiveUpSearches: 42 });
    expect(loadSettings().settleGiveUpSearches).toBe(42);
  });

  it("keeps the chosen number while 'never give up' overrides the threshold", () => {
    const settings = { ...DEFAULT_SETTINGS, settleGiveUpSearches: 7, neverGiveUp: true };
    expect(effectiveGiveUpSearches(settings)).toBe(NEVER_GIVE_UP_SEARCHES);
    // Turning it back off restores the number the user picked.
    expect(effectiveGiveUpSearches({ ...settings, neverGiveUp: false })).toBe(7);
  });

  it("survives a JSON round-trip with 'never give up' on", () => {
    saveSettings({ ...DEFAULT_SETTINGS, settleGiveUpSearches: 7, neverGiveUp: true });
    const loaded = loadSettings();
    expect(loaded.neverGiveUp).toBe(true);
    expect(loaded.settleGiveUpSearches).toBe(7);
    expect(effectiveGiveUpSearches(loaded)).toBe(NEVER_GIVE_UP_SEARCHES);
  });
});
