import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './prefs.ts';

describe('prefs', () => {
  const original = globalThis.localStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, 'localStorage', {
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
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: original,
    });
  });

  it('round-trips highlightWhileThinking', () => {
    saveSettings({ highlightWhileThinking: false });
    expect(loadSettings()).toEqual({ highlightWhileThinking: false });
    saveSettings({ highlightWhileThinking: true });
    expect(loadSettings()).toEqual({ highlightWhileThinking: true });
  });

  it('returns defaults for missing or corrupt storage', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    store['caro.settings'] = '{not-json';
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    store['caro.settings'] = JSON.stringify({ highlightWhileThinking: 'yes' });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
