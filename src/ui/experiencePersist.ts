import type { Difficulty } from '../engine/engine.ts';
import {
  ExperienceStore,
  type StoredExperienceEntry,
} from '../engine/experience.ts';
import { logger } from '../utils/logger.ts';

export const LEGACY_EXPERIENCE_STORAGE_KEY = 'caro-engine-experience-v1';
export const EXPERIENCE_STORAGE_KEY_PREFIX = 'caro-engine-experience-v2-';

const DIFFICULTIES: readonly Difficulty[] = [
  'easy',
  'medium',
  'hard',
  'expert',
];

interface ExperienceFile {
  version: 2;
  entries: StoredExperienceEntry[];
}

export function experienceStorageKey(difficulty: Difficulty): string {
  return `${EXPERIENCE_STORAGE_KEY_PREFIX}${difficulty}`;
}

function readStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function parseFile(raw: string): StoredExperienceEntry[] {
  try {
    const parsed = JSON.parse(raw) as ExperienceFile;
    if (parsed?.version !== 2 || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries;
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
export function loadExperienceStore(
  store: ExperienceStore,
  difficulty: Difficulty,
): void {
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
export function saveExperienceStore(
  store: ExperienceStore,
  difficulty: Difficulty,
): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  const payload: ExperienceFile = {
    version: 2,
    entries: store.entries(),
  };
  try {
    storage.setItem(experienceStorageKey(difficulty), JSON.stringify(payload));
  } catch (error) {
    logger.error('Failed to persist experience cache:', error);
  }
}

/**
 * Main-thread experience books: one LRU store + localStorage key per difficulty.
 * Workers receive baselines via the engine protocol; they do not own disk.
 */
export class PersistentExperienceStore {
  private readonly books: Record<Difficulty, ExperienceStore>;
  private readonly dirty = new Set<Difficulty>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(options?: { maxEntries?: number; debounceMs?: number }) {
    const maxEntries = options?.maxEntries ?? 2000;
    this.debounceMs = options?.debounceMs ?? 250;
    this.books = {
      easy: new ExperienceStore(maxEntries),
      medium: new ExperienceStore(maxEntries),
      hard: new ExperienceStore(maxEntries),
      expert: new ExperienceStore(maxEntries),
    };
    discardLegacyExperienceStorage();
    for (const difficulty of DIFFICULTIES) {
      loadExperienceStore(this.books[difficulty], difficulty);
    }
  }

  book(difficulty: Difficulty): ExperienceStore {
    return this.books[difficulty];
  }

  get(difficulty: Difficulty, key: string) {
    return this.books[difficulty].get(key);
  }

  put(
    difficulty: Difficulty,
    key: string,
    entry: Parameters<ExperienceStore['put']>[1],
  ): boolean {
    const changed = this.books[difficulty].put(key, entry);
    if (changed) {
      this.scheduleSave(difficulty);
    }
    return changed;
  }

  markSettled(difficulty: Difficulty, key: string): void {
    if (this.books[difficulty].markSettled(key)) {
      this.scheduleSave(difficulty);
    }
  }

  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    for (const difficulty of this.dirty) {
      saveExperienceStore(this.books[difficulty], difficulty);
    }
    this.dirty.clear();
  }

  private scheduleSave(difficulty: Difficulty): void {
    this.dirty.add(difficulty);
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      for (const dirtyDifficulty of this.dirty) {
        saveExperienceStore(this.books[dirtyDifficulty], dirtyDifficulty);
      }
      this.dirty.clear();
    }, this.debounceMs);
  }
}
