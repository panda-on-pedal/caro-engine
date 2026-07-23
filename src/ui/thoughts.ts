import type { SearchProgressEvent } from '../engine/search/searchProgress.ts';

/** English-only thought templates. Intentional: not routed through i18n. */
export function formatThought(event: SearchProgressEvent): string {
  switch (event.type) {
    case 'phase':
      if (event.phase === 'scanning') {
        return 'Looking over the board…';
      }
      if (event.phase === 'quiet') {
        return 'This looks quiet…';
      }
      return 'Searching interesting lines…';
    case 'candidates':
      return `I see about ${event.count} interesting spots…`;
    case 'examining':
      return `Let me check ${event.row},${event.col}…`;
    case 'insight':
      return formatInsight(event.row, event.col, event.kind);
    case 'bestSoFar':
      return `${event.row},${event.col} looks strongest so far…`;
    case 'deeper':
      return 'Looking a bit deeper…';
    case 'experienceHit':
      return `I remember this spot — ${event.row},${event.col} (depth ${event.depth})…`;
  }
}

function formatInsight(row: number, col: number, kind: string): string {
  const cell = `${row},${col}`;
  switch (kind) {
    case 'win':
      return `Hmm, ${cell} looks like a win…`;
    case 'open-four':
      return `Hmm, ${cell} could build an open-four…`;
    case 'four':
      return `Hmm, ${cell} could build a four…`;
    case 'open-three':
      return `Hmm, ${cell} could build an open-three…`;
    case 'fork':
      return `Hmm, ${cell} looks like a fork…`;
    case 'block':
      return `Hmm, ${cell} might need blocking…`;
    default:
      return `Hmm, ${cell} is interesting…`;
  }
}
