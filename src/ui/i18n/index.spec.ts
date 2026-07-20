import { isLocale, setLocale, t } from './index.ts';

describe('isLocale', () => {
  it('accepts en and vi only', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('vi')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
  });
});

describe('t', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('returns English strings by default', () => {
    expect(t('status.yourTurn')).toBe('Your turn');
    expect(t('controls.newGame')).toBe('New Game');
  });

  it('switches to Vietnamese', () => {
    setLocale('vi');
    expect(t('status.yourTurn')).toBe('Lượt của bạn');
    expect(t('controls.newGame')).toBe('Ván mới');
  });

  it('interpolates named params', () => {
    expect(t('status.playerAiWins', { player: 2 })).toBe('Player 2 (AI) wins!');
    expect(t('cell.title', { row: 3, col: 7 })).toBe('Row 3, Col 7');
    expect(t('boards.n', { n: 4 })).toBe('4 boards');
  });

  it('interpolates in Vietnamese', () => {
    setLocale('vi');
    expect(t('status.playerAiThinking', { player: 1 })).toBe('Người chơi 1 (AI) đang nghĩ…');
    expect(t('tabs.board', { n: 1, p1: 'hard', p2: 'easy', moves: 23 })).toBe(
      'B1: hard×easy · 23',
    );
  });
});
