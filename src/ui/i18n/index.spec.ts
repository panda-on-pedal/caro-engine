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
    expect(t('status.playerAiWins', { player: 2 })).toBe('Player 2 (Computer) wins!');
    expect(t('cell.title', { row: 3, col: 7 })).toBe('Row 3, Col 7');
    expect(t('boards.n', { n: 4 })).toBe('4 boards');
  });

  it('interpolates in Vietnamese', () => {
    setLocale('vi');
    expect(t('status.playerAiThinking', { player: 1 })).toBe('Người chơi 1 (Máy tính) đang nghĩ…');
    expect(t('tabs.board', { n: 1, p1: 'hard', p2: 'easy', moves: 23 })).toBe(
      'B1: hard×easy · 23',
    );
  });

  it('interpolates server retry messages', () => {
    expect(t('status.serverRetry', { attempt: 2, max: 5 })).toBe(
      'Server unavailable. Retrying (2/5)…',
    );
    setLocale('vi');
    expect(t('status.serverUnavailable')).toBe(
      'Máy chủ không phản hồi. Thay đổi có thể chưa được lưu.',
    );
  });

  it('exposes settings and instructions chrome in English and Vietnamese', () => {
    expect(t('nav.settings')).toBe('Settings');
    expect(t('nav.github')).toBe('GitHub repository');
    expect(t('settings.language')).toBe('Language');
    expect(t('settings.highlightWhileThinking')).toBe('Highlight cells while thinking');
    expect(t('settings.showThoughts')).toBe('Show computer thoughts');
    expect(t('settings.experienceImprovement')).toContain('Learn from Human');
    expect(t('instructions.title')).toBe('Instructions');
    expect(t('version.updateAvailable', { version: '1.2.0' })).toBe('Update available · v1.2.0');
    setLocale('vi');
    expect(t('settings.back')).toBe('Quay lại');
    expect(t('settings.title')).toBe('Cài đặt');
    expect(t('settings.experienceImprovement')).toContain('Học từ');
    expect(t('nav.instructions')).toBe('Hướng dẫn');
    expect(t('instructions.tips.block')).toContain('chặn');
    expect(t('version.updateAvailable', { version: '1.2.0' })).toBe('Có bản mới · v1.2.0');
  });
});
