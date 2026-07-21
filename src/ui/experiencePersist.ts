import {
  ExperienceStore,
  type StoredExperienceEntry,
} from '../engine/experience.ts';
import { logger } from '../utils/logger.ts';

export const EXPERIENCE_STORAGE_KEY = 'caro-engine-experience-v1';

interface ExperienceFile {
  version: 1;
  entries: StoredExperienceEntry[];
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
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries;
  } catch {
    return [];
  }
}

/** Load disk-backed experience into `store`. Safe no-op when storage missing/corrupt. */
export function loadExperienceStore(store: ExperienceStore): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  const raw = storage.getItem(EXPERIENCE_STORAGE_KEY);
  if (raw === null) {
    return;
  }
  store.loadAll(parseFile(raw));
}

/** Persist `store` to localStorage. Debounce via callers if needed. */
export function saveExperienceStore(store: ExperienceStore): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  const payload: ExperienceFile = {
    version: 1,
    entries: store.entries(),
  };
  try {
    storage.setItem(EXPERIENCE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    logger.error('Failed to persist experience cache:', error);
  }
}

/**
 * Main-thread experience book: memory LRU + localStorage durability.
 * Workers receive baselines via the engine protocol; they do not own disk.
 */
export class PersistentExperienceStore {
  readonly memory: ExperienceStore;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(options?: { maxEntries?: number; debounceMs?: number }) {
    this.memory = new ExperienceStore(options?.maxEntries ?? 2000);
    this.debounceMs = options?.debounceMs ?? 250;
    loadExperienceStore(this.memory);
  }

  get(key: string) {
    return this.memory.get(key);
  }

  put(key: string, entry: Parameters<ExperienceStore['put']>[1]): boolean {
    const changed = this.memory.put(key, entry);
    if (changed) {
      this.scheduleSave();
    }
    return changed;
  }

  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    saveExperienceStore(this.memory);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      saveExperienceStore(this.memory);
    }, this.debounceMs);
  }
}
