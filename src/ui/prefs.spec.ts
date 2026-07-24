import { loadSettings, saveSettings, DEFAULT_SETTINGS } from "./prefs.ts";

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
    expect(DEFAULT_SETTINGS.settleGiveUpSearches).toBe(3);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips highlightWhileThinking, showThoughts, improvements, and lang", () => {
    saveSettings({
      highlightWhileThinking: false,
      showThoughts: true,
      experienceImprovement: true,
      practiceImprovement: true,
      settleGiveUpSearches: 3,
      lang: "en",
    });
    expect(loadSettings()).toEqual({
      highlightWhileThinking: false,
      showThoughts: true,
      experienceImprovement: true,
      practiceImprovement: true,
      settleGiveUpSearches: 3,
      lang: "en",
    });
    saveSettings({
      highlightWhileThinking: true,
      showThoughts: false,
      experienceImprovement: false,
      practiceImprovement: false,
      settleGiveUpSearches: 5,
      lang: "vi",
    });
    expect(loadSettings()).toEqual({
      highlightWhileThinking: true,
      showThoughts: false,
      experienceImprovement: false,
      practiceImprovement: false,
      settleGiveUpSearches: 5,
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
      showThoughts: true,
      experienceImprovement: true,
      practiceImprovement: true,
      settleGiveUpSearches: 3,
      lang: "vi",
    });
  });

  it("defaults settleGiveUpSearches to 3", () => {
    store = {};
    expect(loadSettings().settleGiveUpSearches).toBe(3);
  });

  it("clamps a persisted settleGiveUpSearches into 1..9", () => {
    store["caro.settings"] = JSON.stringify({ settleGiveUpSearches: 42 });
    expect(loadSettings().settleGiveUpSearches).toBe(9);
    store["caro.settings"] = JSON.stringify({ settleGiveUpSearches: 0 });
    expect(loadSettings().settleGiveUpSearches).toBe(1);
  });
});
