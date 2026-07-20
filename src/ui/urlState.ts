import { isLocale, type Locale } from './i18n/index.ts';

export type GameMode = 'human-ai' | 'ai-human' | 'ai-ai';

export type UrlState = {
  lang: Locale;
  mode: GameMode;
};

type Listener = (state: UrlState, prev: UrlState) => void;

const DEFAULT_STATE: UrlState = { lang: 'en', mode: 'human-ai' };

const listeners = new Set<Listener>();
let current: UrlState = { ...DEFAULT_STATE };

function isGameMode(value: string): value is GameMode {
  return value === 'human-ai' || value === 'ai-human' || value === 'ai-ai';
}

function parseSearch(search: string): UrlState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const langRaw = params.get('lang') ?? '';
  const modeRaw = params.get('mode') ?? '';
  return {
    lang: isLocale(langRaw) ? langRaw : DEFAULT_STATE.lang,
    mode: isGameMode(modeRaw) ? modeRaw : DEFAULT_STATE.mode,
  };
}

function writeSearch(state: UrlState): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set('lang', state.lang);
  url.searchParams.set('mode', state.mode);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === currentPath) {
    return;
  }
  window.history.replaceState(window.history.state, '', next);
}

function notify(prev: UrlState): void {
  for (const listener of listeners) {
    listener(current, prev);
  }
}

export function getUrlState(): UrlState {
  return current;
}

/** Merge patch into state, sync URL, notify subscribers. No-op if unchanged. */
export function setUrlState(patch: Partial<UrlState>): void {
  const next: UrlState = {
    lang: patch.lang ?? current.lang,
    mode: patch.mode ?? current.mode,
  };
  if (next.lang === current.lang && next.mode === current.mode) {
    return;
  }
  const prev = current;
  current = next;
  writeSearch(current);
  notify(prev);
}

/**
 * Read the current location search into the store, canonicalize the URL, and
 * optionally notify. Used at boot and on `popstate`.
 */
export function hydrateFromUrl(options?: { notify?: boolean }): UrlState {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const next = parseSearch(search);
  const prev = current;
  const changed = next.lang !== current.lang || next.mode !== current.mode;
  current = next;
  writeSearch(current);
  if (options?.notify && changed) {
    notify(prev);
  }
  return current;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Parse helpers exported for unit tests (no DOM required). */
export function parseUrlState(search: string): UrlState {
  return parseSearch(search);
}

export function installPopstateListener(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  const onPopState = (): void => {
    hydrateFromUrl({ notify: true });
  };
  window.addEventListener('popstate', onPopState);
  return () => {
    window.removeEventListener('popstate', onPopState);
  };
}
