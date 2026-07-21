import { parseHash } from './hashRoute.ts';

describe('hashRoute', () => {
  test('parseHash maps settings and falls back to play', () => {
    expect(parseHash('#/settings')).toBe('settings');
    expect(parseHash('#settings')).toBe('settings');
    expect(parseHash('#/')).toBe('play');
    expect(parseHash('')).toBe('play');
    expect(parseHash('#/other')).toBe('play');
  });
});
