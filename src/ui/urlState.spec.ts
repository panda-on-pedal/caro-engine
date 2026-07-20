import {
  getUrlState,
  hydrateFromUrl,
  parseUrlState,
  setUrlState,
  subscribe,
} from './urlState.ts';

describe('parseUrlState', () => {
  it('reads valid lang and mode', () => {
    expect(parseUrlState('?lang=vi&mode=ai-human')).toEqual({ lang: 'vi', mode: 'ai-human' });
  });

  it('defaults invalid or missing params', () => {
    expect(parseUrlState('')).toEqual({ lang: 'en', mode: 'human-ai' });
    expect(parseUrlState('?lang=fr&mode=nope')).toEqual({ lang: 'en', mode: 'human-ai' });
    expect(parseUrlState('?lang=vi')).toEqual({ lang: 'vi', mode: 'human-ai' });
    expect(parseUrlState('?mode=ai-ai')).toEqual({ lang: 'en', mode: 'ai-ai' });
  });
});

describe('urlState store', () => {
  let href: string;

  beforeEach(() => {
    href = 'http://localhost/?lang=en&mode=human-ai';
    const location = {
      get href() {
        return href;
      },
      get search() {
        return new URL(href).search;
      },
      get pathname() {
        return new URL(href).pathname;
      },
      get hash() {
        return new URL(href).hash;
      },
    };
    const history = {
      state: {},
      replaceState(_state: unknown, _title: string, url?: string | null): void {
        if (typeof url === 'string') {
          href = new URL(url, href).href;
        }
      },
    };
    (globalThis as { window: unknown }).window = { location, history };
    hydrateFromUrl();
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('hydrates from the current URL and canonicalizes missing params', () => {
    href = 'http://localhost/?lang=vi&mode=ai-ai';
    const state = hydrateFromUrl();
    expect(state).toEqual({ lang: 'vi', mode: 'ai-ai' });
    expect(getUrlState()).toEqual({ lang: 'vi', mode: 'ai-ai' });
    expect(href).toContain('lang=vi');
    expect(href).toContain('mode=ai-ai');
  });

  it('notifies subscribers when setUrlState changes a field', () => {
    const seen: Array<{ next: string; prev: string }> = [];
    const unsubscribe = subscribe((next, prev) => {
      seen.push({ next: `${next.lang}:${next.mode}`, prev: `${prev.lang}:${prev.mode}` });
    });

    setUrlState({ lang: 'vi' });
    setUrlState({ mode: 'ai-human' });
    setUrlState({ lang: 'vi', mode: 'ai-human' });

    expect(seen).toEqual([
      { next: 'vi:human-ai', prev: 'en:human-ai' },
      { next: 'vi:ai-human', prev: 'vi:human-ai' },
    ]);
    expect(href).toContain('lang=vi');
    expect(href).toContain('mode=ai-human');
    unsubscribe();
  });

  it('hydrateFromUrl with notify fires when the URL changed under us', () => {
    const seen: string[] = [];
    const unsubscribe = subscribe((next) => {
      seen.push(next.mode);
    });

    href = 'http://localhost/?lang=en&mode=ai-ai';
    hydrateFromUrl({ notify: true });

    expect(seen).toEqual(['ai-ai']);
    unsubscribe();
  });
});
