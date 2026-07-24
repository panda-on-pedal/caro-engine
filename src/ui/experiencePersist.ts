import type { Difficulty } from "../engine/engine.ts";
import { ExperienceStore, type StoredExperienceEntry } from "../engine/experience/experience.ts";
import { logger } from "../utils/logger.ts";
import { evictSlice } from "./ttPersist.ts";

export const LEGACY_EXPERIENCE_STORAGE_KEY = "caro-engine-experience-v1";
export const EXPERIENCE_STORAGE_KEY_PREFIX = "caro-engine-experience-v2-";
export const HUMAN_BOOK_STORAGE_KEY = "caro-engine-human-book-v1";
/** Legacy `settled: true` rows coerce to this stallCount (permanent under any
 *  reasonable give-up threshold). */
export const LEGACY_PERMANENT_STALLS = 99;

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard", "expert"];

interface ExperienceFile {
  version: 2 | 3;
  entries: StoredExperienceEntry[];
}

export function experienceStorageKey(difficulty: Difficulty): string {
  return `${EXPERIENCE_STORAGE_KEY_PREFIX}${difficulty}`;
}

function readStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function parseFile(raw: string): StoredExperienceEntry[] {
  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      entries?: Array<Record<string, unknown>>;
    };
    if ((parsed?.version !== 2 && parsed?.version !== 3) || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries.map(row => {
      const legacySettled = row.settled === true;
      const stallCount =
        typeof row.stallCount === "number"
          ? row.stallCount
          : legacySettled
            ? LEGACY_PERMANENT_STALLS
            : 0;
      const settleLevel = typeof row.settleLevel === "number" ? row.settleLevel : 0;
      return { ...(row as unknown as StoredExperienceEntry), settleLevel, stallCount };
    });
  } catch {
    return [];
  }
}

/** Drop the pre-split single-book key. No migration. */
export function discardLegacyExperienceStorage(): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(LEGACY_EXPERIENCE_STORAGE_KEY);
  } catch {
    // ignore quota / private-mode quirks
  }
}

/** Load disk-backed experience into `store`. Safe no-op when storage missing/corrupt. */
export function loadExperienceStore(store: ExperienceStore, difficulty: Difficulty): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  const raw = storage.getItem(experienceStorageKey(difficulty));
  if (raw === null) {
    return;
  }
  store.loadAll(parseFile(raw));
}

/** Persist `store` to localStorage. Debounce via callers if needed. */
export function saveExperienceStore(store: ExperienceStore, difficulty: Difficulty): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  const payload: ExperienceFile = {
    version: 3,
    entries: store.entries(),
  };
  try {
    storage.setItem(experienceStorageKey(difficulty), JSON.stringify(payload));
  } catch (error) {
    logger.error("Failed to persist experience cache:", error);
  }
}

/** Load the shared human book. Safe no-op when storage is missing/corrupt. */
export function loadHumanBook(store: ExperienceStore): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  const raw = storage.getItem(HUMAN_BOOK_STORAGE_KEY);
  if (raw === null) {
    return;
  }
  store.loadAll(parseFile(raw));
}

/** Persist the shared human book to its own localStorage key. */
export function saveHumanBook(store: ExperienceStore): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  const payload: ExperienceFile = {
    version: 3,
    entries: store.entries(),
  };
  try {
    storage.setItem(HUMAN_BOOK_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    logger.error("Failed to persist human book:", error);
  }
}

/**
 * Main-thread experience books: one LRU store + localStorage key per difficulty.
 * Workers receive baselines via the engine protocol; they do not own disk.
 */
export class PersistentExperienceStore {
  private readonly books: Record<Difficulty, ExperienceStore>;
  private readonly humanBook: ExperienceStore;
  private readonly dirty = new Set<Difficulty>();
  private humanDirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(options?: { maxEntries?: number; debounceMs?: number }) {
    const maxEntries = options?.maxEntries ?? 4000;
    this.debounceMs = options?.debounceMs ?? 250;
    this.books = {
      easy: new ExperienceStore(maxEntries, key => void evictSlice(key)),
      medium: new ExperienceStore(maxEntries, key => void evictSlice(key)),
      hard: new ExperienceStore(maxEntries, key => void evictSlice(key)),
      expert: new ExperienceStore(maxEntries, key => void evictSlice(key)),
    };
    discardLegacyExperienceStorage();
    for (const difficulty of DIFFICULTIES) {
      loadExperienceStore(this.books[difficulty], difficulty);
    }
    this.humanBook = new ExperienceStore(maxEntries);
    loadHumanBook(this.humanBook);
  }

  book(difficulty: Difficulty): ExperienceStore {
    return this.books[difficulty];
  }

  get(difficulty: Difficulty, key: string) {
    return this.books[difficulty].get(key);
  }

  put(difficulty: Difficulty, key: string, entry: Parameters<ExperienceStore["put"]>[1]): boolean {
    const changed = this.books[difficulty].put(key, entry);
    if (changed) {
      this.scheduleSave(difficulty);
    }
    return changed;
  }

  setStallCount(difficulty: Difficulty, key: string, count: number): void {
    if (this.books[difficulty].setStallCount(key, count)) {
      this.scheduleSave(difficulty);
    }
  }

  getHuman(key: string): ReturnType<ExperienceStore["get"]> {
    return this.humanBook.get(key);
  }

  putHuman(key: string, entry: Parameters<ExperienceStore["put"]>[1]): boolean {
    const changed = this.humanBook.put(key, entry);
    if (changed) {
      this.humanDirty = true;
      this.arm();
    }
    return changed;
  }

  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persistDirty();
  }

  private scheduleSave(difficulty: Difficulty): void {
    this.dirty.add(difficulty);
    this.arm();
  }

  private arm(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistDirty();
    }, this.debounceMs);
  }

  private persistDirty(): void {
    for (const difficulty of this.dirty) {
      saveExperienceStore(this.books[difficulty], difficulty);
    }
    this.dirty.clear();
    if (this.humanDirty) {
      saveHumanBook(this.humanBook);
      this.humanDirty = false;
    }
  }
}
