export type AppRoute = 'play' | 'settings' | 'instructions';

/** Parse `location.hash` into an app route. Unknown hashes fall back to play. */
export function parseHash(hash: string): AppRoute {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const path = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  if (path === 'settings') {
    return 'settings';
  }
  if (path === 'instructions') {
    return 'instructions';
  }
  return 'play';
}

/** Navigate via hash without touching `?mode=` search params. */
export function setHashRoute(route: AppRoute): void {
  if (typeof window === 'undefined') {
    return;
  }
  const next =
    route === 'settings' ? '#/settings' : route === 'instructions' ? '#/instructions' : '#/';
  const current = window.location.hash;
  if (route === 'play' && (current === '' || current === '#' || current === '#/')) {
    if (current !== '#/') {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#/`);
    }
    return;
  }
  if (current === next) {
    return;
  }
  window.location.hash = next;
}
