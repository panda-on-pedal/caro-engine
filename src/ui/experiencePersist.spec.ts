import {
  LEGACY_EXPERIENCE_STORAGE_KEY,
  LEGACY_PERMANENT_STALLS,
  HUMAN_BOOK_STORAGE_KEY,
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

    expect(memory[experienceStorageKey("easy")]).toContain('"version":3');
    expect(memory[experienceStorageKey("hard")]).toBeUndefined();

    const restored = new ExperienceStore();
    loadExperienceStore(restored, "easy");
    expect(restored.get("k")).toEqual({
      move: { row: 1, col: 2 },
      score: 7,
      depth: 4,
      settleLevel: 0,
      stallCount: 0,
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

  it("stores human-book entries under a dedicated key, isolated from difficulty books", () => {
    const books = new PersistentExperienceStore();
    books.putHuman("shape", { move: { row: 3, col: 4 }, score: 0, depth: 1 });
    books.flush();

    // Not visible through any difficulty book.
    expect(books.get("easy", "shape")).toBeUndefined();
    expect(books.getHuman("shape")?.move).toEqual({ row: 3, col: 4 });
    // Persisted under its own storage key, not a difficulty key.
    expect(memory[HUMAN_BOOK_STORAGE_KEY]).toContain('"version":3');
    expect(memory[experienceStorageKey("easy")]).toBeUndefined();

    // Reloads from disk on a fresh instance.
    const reloaded = new PersistentExperienceStore();
    expect(reloaded.getHuman("shape")?.move).toEqual({ row: 3, col: 4 });
  });

  it("latest human-win move wins on the same key", () => {
    const books = new PersistentExperienceStore();
    books.putHuman("shape", { move: { row: 1, col: 1 }, score: 0, depth: 1 });
    books.putHuman("shape", { move: { row: 2, col: 2 }, score: 0, depth: 1 });
    expect(books.getHuman("shape")?.move).toEqual({ row: 2, col: 2 });
  });

  it("coerces a legacy v2 settled:true row to a permanent stallCount on load", () => {
    const key = experienceStorageKey("hard");
    memory[key] = JSON.stringify({
      version: 2,
      entries: [
        { key: "p", move: { row: 1, col: 1 }, score: 50, depth: 4, settled: true, updatedAt: 1 },
      ],
    });
    const store = new ExperienceStore();
    loadExperienceStore(store, "hard");
    expect(store.get("p")?.stallCount).toBe(LEGACY_PERMANENT_STALLS);
  });

  it("round-trips settleLevel and stallCount through save/load as version 3", () => {
    const store = new ExperienceStore();
    store.put("p", {
      move: { row: 2, col: 3 },
      score: 70,
      depth: 5,
      settleLevel: 2,
      stallCount: 1,
    });
    saveExperienceStore(store, "hard");
    const raw = memory[experienceStorageKey("hard")];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw) as { version: number };
    expect(parsed.version).toBe(3);
    const reload = new ExperienceStore();
    loadExperienceStore(reload, "hard");
    expect(reload.get("p")?.settleLevel).toBe(2);
    expect(reload.get("p")?.stallCount).toBe(1);
  });
});
