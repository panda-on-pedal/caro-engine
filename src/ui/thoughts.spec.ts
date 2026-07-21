import type { SearchProgressEvent } from '../engine/searchProgress.ts';
import { formatThought } from './thoughts.ts';

describe('formatThought', () => {
  const cases: SearchProgressEvent[] = [
    { type: 'phase', phase: 'scanning' },
    { type: 'phase', phase: 'searching' },
    { type: 'phase', phase: 'quiet' },
    { type: 'candidates', count: 7, source: 'tactical' },
    { type: 'examining', row: 3, col: 8 },
    { type: 'insight', row: 3, col: 8, kind: 'open-four' },
    { type: 'insight', row: 1, col: 2, kind: 'win' },
    { type: 'insight', row: 1, col: 2, kind: 'four' },
    { type: 'insight', row: 1, col: 2, kind: 'open-three' },
    { type: 'insight', row: 1, col: 2, kind: 'fork' },
    { type: 'insight', row: 1, col: 2, kind: 'block' },
    { type: 'bestSoFar', row: 10, col: 11 },
    { type: 'deeper', depth: 3 },
  ];

  it.each(cases)('maps %j to a non-empty English string', (event) => {
    const text = formatThought(event);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\{/);
  });

  it('interpolates cell coordinates', () => {
    expect(formatThought({ type: 'examining', row: 4, col: 9 })).toContain('4,9');
    expect(formatThought({ type: 'bestSoFar', row: 4, col: 9 })).toContain('4,9');
    expect(formatThought({ type: 'candidates', count: 12, source: 'forced' })).toContain(
      '12',
    );
  });
});
