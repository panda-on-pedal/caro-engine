import {
  LEGACY_EXPERIENCE_STORAGE_KEY,
  experienceStorageKey,
  loadExperienceStore,
  saveExperienceStore,
  PersistentExperienceStore,
} from "./experiencePersist.ts";
import { ExperienceStore } from "../engine/experience/experience.ts";

describe("experiencePersist", () => {
  let memory: Record<string, string>;

  beforeEach(() => {
    memory = {};
    const storage = {
      getItem(key: string): string | null {
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      setItem(key: string, value: string): void {
        memory[key] = value;
      },
      removeItem(key: string): void {
        delete memory[key];
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("saves and reloads entries per difficulty key", () => {
    const store = new ExperienceStore();
    store.put("k", { move: { row: 1, col: 2 }, score: 7, depth: 4 });
    saveExperienceStore(store, "easy");

    expect(memory[experienceStorageKey("easy")]).toContain('"version":2');
    expect(memory[experienceStorageKey("hard")]).toBeUndefined();

    const restored = new ExperienceStore();
    loadExperienceStore(restored, "easy");
    expect(restored.get("k")).toEqual({
      move: { row: 1, col: 2 },
      score: 7,
      depth: 4,
    });
  });

  it("keeps the same shape key isolated across difficulties", () => {
    const books = new PersistentExperienceStore();
    books.put("easy", "shape", {
      move: { row: 1, col: 1 },
      score: 1,
      depth: 2,
    });
    books.put("expert", "shape", {
      move: { row: 2, col: 2 },
      score: 9,
      depth: 5,
    });
    books.flush();

    expect(books.get("easy", "shape")?.move).toEqual({ row: 1, col: 1 });
    expect(books.get("expert", "shape")?.move).toEqual({ row: 2, col: 2 });
    expect(memory[experienceStorageKey("easy")]).toBeDefined();
    expect(memory[experienceStorageKey("expert")]).toBeDefined();
  });

  it("discards the legacy v1 key on construct", () => {
    memory[LEGACY_EXPERIENCE_STORAGE_KEY] = JSON.stringify({
      version: 1,
      entries: [],
    });
    new PersistentExperienceStore();
    expect(memory[LEGACY_EXPERIENCE_STORAGE_KEY]).toBeUndefined();
  });

  it("ignores corrupt payloads", () => {
    memory[experienceStorageKey("easy")] = "{not-json";
    const store = new ExperienceStore();
    loadExperienceStore(store, "easy");
    expect(store.size).toBe(0);
  });

  it("persists the settled flag across save/load", () => {
    const store = new ExperienceStore();
    store.put("k", { move: { row: 1, col: 2 }, score: 7, depth: 4 });
    store.markSettled("k");
    saveExperienceStore(store, "hard");

    const restored = new ExperienceStore();
    loadExperienceStore(restored, "hard");
    expect(restored.get("k")?.settled).toBe(true);
  });
});
