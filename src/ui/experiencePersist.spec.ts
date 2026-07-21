import {
  EXPERIENCE_STORAGE_KEY,
  loadExperienceStore,
  saveExperienceStore,
} from './experiencePersist.ts';
import { ExperienceStore } from '../engine/experience.ts';

describe('experiencePersist', () => {
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
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('saves and reloads entries', () => {
    const store = new ExperienceStore();
    store.put('k', { move: { row: 1, col: 2 }, score: 7, depth: 4 });
    saveExperienceStore(store);

    expect(memory[EXPERIENCE_STORAGE_KEY]).toContain('"version":1');

    const restored = new ExperienceStore();
    loadExperienceStore(restored);
    expect(restored.get('k')).toEqual({
      move: { row: 1, col: 2 },
      score: 7,
      depth: 4,
    });
  });

  it('ignores corrupt payloads', () => {
    memory[EXPERIENCE_STORAGE_KEY] = '{not-json';
    const store = new ExperienceStore();
    loadExperienceStore(store);
    expect(store.size).toBe(0);
  });
});
