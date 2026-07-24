import { BOARD_SIZE, type Board, type Player } from "../../engine/board.ts";
import { type Difficulty } from "../../engine/engine.ts";
import { PatternStore } from "../../engine/patterns/patternStore.ts";
import {
  applyMove,
  deserializeState,
  newGame,
  serializeState,
  type GameState,
  type Move,
} from "../../engine/state.ts";
import type { SearchProgressEvent } from "../../engine/search/search.ts";
import type { GameResult } from "../../shared/results.ts";
import { aggregateResults, firstPlayerWinPct, playerLeaderboard } from "../../shared/results.ts";
import {
  EMPTY_REPORT_COUNTS,
  pushCapped,
  summarizeReport,
  tallyReportEvent,
  type PracticeReportCounts,
  type PracticeReportEvent,
  type PracticeReportSummary,
} from "../../shared/practiceReport.ts";
import { logger } from "../../utils/logger.ts";
import type { ExperienceMode } from "../../engine/experience/experience.ts";
import { MIN_EXPERIENCE_DEPTH } from "../../engine/experience/experience.ts";
import { humanWinBookEntries } from "../../engine/experience/experienceLookup.ts";
import { CancelledError, EnginePool } from "../enginePool.ts";
import { PersistentExperienceStore } from "../experiencePersist.ts";
import {
  clearPracticeReport,
  loadPracticeReport,
  savePracticeReport,
} from "../practiceReportPersist.ts";
import { fetchWithRetry } from "../apiClient.ts";
import { isLocale, setLocale, t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/index.ts";
import { loadSettings, saveSettings, type CaroSettings } from "../prefs.ts";
import { formatReportLine, formatThought } from "../thoughts.ts";
import {
  DEFAULT_TOURNAMENT_BOARD_COUNT,
  maxTournamentBoards,
  nextCacheMissStreak,
  pairingAt,
  sessionTabLabel,
  shouldRestartPracticeGame,
  type TournamentDifficulty,
} from "../tournament.ts";
import {
  hydrateFromUrl,
  installPopstateListener,
  isMultiAiMode,
  isTournamentMode,
  setUrlState,
  subscribe,
  type GameMode,
} from "../urlState.ts";

const STATE_URL = "/api/state";
const RESULTS_URL = "/api/results";
const AI_THINK_DELAY_MS = 300;
export const CELL_SIZE_PX = 28;
const GAME_END_PAUSE_MS = 2000;
/** Minimum spacing between multi-AI moves so instant cache-hit replays step
 * visibly instead of blurring the board through many moves at once. */
const MOVE_RENDER_DELAY_MS = 100;
/** Max per-board report lines kept in the thoughts-area feed (rolling). */
const BOARD_REPORT_FEED_CAP = 12;

export interface BoardSession {
  id: number;
  state: GameState;
  p1: TournamentDifficulty;
  p2: TournamentDifficulty;
  busy: boolean;
  gameStartMs: number;
  gamesPlayed: number;
  loopRunning: boolean;
  /** Consecutive plies with no usable experience baseline (practice mode
   * only). Resets on any cache hit. Restart fires at P1 miss then P2 miss. */
  cacheMissStreak: number;
  /** Last practice ply signals — kept so a restart log can show why. */
  lastPracticePly?: {
    player: 1 | 2;
    difficulty: TournamentDifficulty;
    move: Move;
    experienceCacheHit: boolean | undefined;
    experienceStreakEligible: boolean | undefined;
    streakBefore: number;
    streakAfter: number;
    stoneCountBefore: number;
  };
}

export interface ServerNotice {
  key: MessageKey;
  params?: Record<string, string | number>;
  error?: boolean;
}

export interface PairingStatRow {
  p1: string;
  p2: string;
  games: number;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  p1WinPct: number;
  avgP1Moves: number;
  avgP2Moves: number;
}

export interface LeaderboardRow {
  player: string;
  wins: number;
  games: number;
  winPct: number;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cloneState(current: GameState): GameState {
  return deserializeState(serializeState(current));
}

function rebuildHistory(loaded: GameState): {
  current: GameState;
  past: GameState[];
  future: GameState[];
} {
  let current: GameState = newGame();
  const past: GameState[] = [];
  for (const move of loaded.moveHistory) {
    past.push(cloneState(current));
    current = applyMove(current, move, current.nextPlayer);
  }

  const forward: GameState[] = [];
  let cursor = current;
  for (const move of loaded.redoMoves ?? []) {
    cursor = applyMove(cursor, move, cursor.nextPlayer);
    forward.push(cloneState(cursor));
  }

  return { current, past, future: forward.reverse() };
}

function detectHardwareConcurrency(): number {
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return navigator.hardwareConcurrency;
  }
  return 4;
}

function desiredPoolSize(count: number): number {
  return Math.max(1, Math.min(count, maxTournamentBoards(detectHardwareConcurrency())));
}

function inkTiltDegrees(row: number, col: number): number {
  const seed = (row * 928371 + col * 129871) % 7;
  return (seed - 3) * 2.5;
}

function boardToAscii(board: Board): string {
  const symbol = (cell: number): string => (cell === 1 ? "X" : cell === 2 ? "O" : ".");

  let minRow = BOARD_SIZE;
  let maxRow = -1;
  let minCol = BOARD_SIZE;
  let maxCol = -1;
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== 0) {
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
      }
    }
  }
  if (maxRow === -1) {
    const center = Math.floor(BOARD_SIZE / 2);
    minRow = maxRow = minCol = maxCol = center;
  }

  const startRow = Math.max(0, minRow - 1);
  const endRow = Math.min(BOARD_SIZE - 1, maxRow + 1);
  const startCol = Math.max(0, minCol - 1);
  const endCol = Math.min(BOARD_SIZE - 1, maxCol + 1);

  const colHeader =
    "   " +
    Array.from({ length: endCol - startCol + 1 }, (_, i) => String(startCol + i).padStart(3)).join(
      ""
    );
  const rows: string[] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    let line = String(row).padStart(3);
    for (let col = startCol; col <= endCol; col += 1) {
      line += symbol(board[row][col]).padStart(3);
    }
    rows.push(line);
  }
  return [colHeader, ...rows].join("\n");
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

class GameSession {
  state = $state<GameState>(newGame());
  past = $state<GameState[]>([]);
  future = $state<GameState[]>([]);
  busy = $state(false);
  mode = $state<GameMode>("human-ai");
  difficulty = $state<Difficulty>("hard");
  autoplayPaused = $state(false);
  sessions = $state<BoardSession[]>([]);
  activeIndex = $state(0);
  viewingResults = $state(false);
  viewingReports = $state(false);
  /** Multi-AI modes wait on the Start button before running their loops. */
  started = $state(false);
  boardCount = $state(DEFAULT_TOURNAMENT_BOARD_COUNT);
  maxBoardCount = $state(maxTournamentBoards(detectHardwareConcurrency()));
  gameResults = $state<GameResult[]>([]);
  reportEvents = $state<PracticeReportEvent[]>([]);
  reportCounts = $state<PracticeReportCounts>({ ...EMPTY_REPORT_COUNTS });
  bookEntryCount = $state(0);
  /** Per-board live report lines (newest last), keyed by BoardSession.id.
   *  Rendered in the thoughts area for the active board in practice mode. */
  boardReportLines = $state<Record<number, string[]>>({});
  serverNotice = $state<ServerNotice | null>(null);
  thoughtLines = $state<string[]>([]);
  thinkingCell = $state<{ row: number; col: number } | null>(null);
  settings = $state<CaroSettings>(loadSettings());
  asciiOpen = $state(false);
  /** Bumped when locale or static copy must refresh. */
  localeTick = $state(0);
  lang = $state<"en" | "vi">(loadSettings().lang);
  ready = $state(false);

  private patternStore = PatternStore.fromBoard(newGame().board);
  private generation = 0;
  private readonly experienceStore = new PersistentExperienceStore();
  private reportSaveTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly reportSink = (event: PracticeReportEvent): void => {
    this.reportCounts = tallyReportEvent(this.reportCounts, event);
    this.reportEvents = pushCapped(this.reportEvents, event);
    this.bookEntryCount = this.countBookEntries();
    this.appendBoardReport(event);
    this.scheduleReportSave();
  };

  private pool = new EnginePool(1, this.experienceStore, this.reportSink);
  private pairingCounter = 0;
  private sessionIdCounter = 0;
  private unsubUrl: (() => void) | null = null;
  private unsubPop: (() => void) | null = null;

  get humanPlayer(): Player | null {
    if (this.mode === "human-ai") {
      return 1;
    }
    if (this.mode === "ai-human") {
      return 2;
    }
    return null;
  }

  get historyLocked(): boolean {
    return isMultiAiMode(this.mode) && !this.autoplayPaused;
  }

  get activeGameState(): GameState {
    if (isMultiAiMode(this.mode)) {
      return this.sessions[this.activeIndex]?.state ?? newGame();
    }
    return this.state;
  }

  get activeBusy(): boolean {
    if (isMultiAiMode(this.mode)) {
      return this.sessions[this.activeIndex]?.busy ?? false;
    }
    return this.busy;
  }

  get showingResults(): boolean {
    return isTournamentMode(this.mode) && this.viewingResults;
  }

  get showingReports(): boolean {
    return this.mode === "practice" && this.viewingReports;
  }

  get reportSummary(): PracticeReportSummary {
    void this.localeTick;
    return summarizeReport(this.reportCounts, this.bookEntryCount);
  }

  /** The active board's report lines — surfaced in the thoughts area (practice). */
  get activeBoardReportLines(): string[] {
    void this.localeTick;
    const boardId = this.sessions[this.activeIndex]?.id;
    return boardId === undefined ? [] : (this.boardReportLines[boardId] ?? []);
  }

  private experienceMode(): ExperienceMode {
    return this.mode === "practice" ? "practice" : "use";
  }

  /** Human games only write when the Settings toggle is on; Practice/Tournament always write. */
  private persistExperience(): boolean {
    if (this.mode === "practice" || this.mode === "ai-ai") {
      return true;
    }
    return this.settings.experienceImprovement;
  }

  get canUndo(): boolean {
    return !this.busy && !this.historyLocked && this.past.length > 0;
  }

  get canRedo(): boolean {
    return !this.busy && !this.historyLocked && this.future.length > 0;
  }

  get statusMessage(): string {
    void this.localeTick;
    return this.statusText(this.activeGameState);
  }

  get statusDone(): boolean {
    return this.activeGameState.winner !== null;
  }

  get statusDetailText(): string {
    void this.localeTick;
    if (this.serverNotice) {
      return t(this.serverNotice.key, this.serverNotice.params);
    }
    // Practice learning feed is independent of "Show computer thoughts" (that
    // toggle is for live human-vs-AI search narration).
    if (this.mode === "practice") {
      const lines = this.activeBoardReportLines;
      if (lines.length > 0) {
        return lines.join("\n");
      }
      return "";
    }
    if (!this.settings.showThoughts) {
      return "";
    }
    if (this.thoughtLines.length > 0) {
      return this.thoughtLines.join("\n");
    }
    return "";
  }

  get statusDetailSeverity(): "error" | null {
    if (this.serverNotice?.error) {
      return "error";
    }
    return null;
  }

  get matchupSides(): { p1: string; p2: string } {
    void this.localeTick;
    if (this.mode === "human-ai") {
      return { p1: t("matchup.human"), p2: t("matchup.computer") };
    }
    if (this.mode === "ai-human") {
      return { p1: t("matchup.computer"), p2: t("matchup.human") };
    }
    const boardSession = this.sessions[this.activeIndex];
    if (!boardSession) {
      return { p1: t("matchup.computer"), p2: t("matchup.computer") };
    }
    return {
      p1: this.difficultyLabel(boardSession.p1),
      p2: this.difficultyLabel(boardSession.p2),
    };
  }

  get asciiText(): string {
    return boardToAscii(this.activeGameState.board);
  }

  get pairingStats(): PairingStatRow[] {
    return aggregateResults(this.gameResults);
  }

  get leaderboard(): LeaderboardRow[] {
    return playerLeaderboard(this.gameResults);
  }

  get firstPlayerWinPctLabel(): string {
    void this.localeTick;
    return t("stats.firstPlayerWinPct", { pct: formatPct(firstPlayerWinPct(this.gameResults)) });
  }

  inkTilt(row: number, col: number): number {
    return inkTiltDegrees(row, col);
  }

  cellTitle(row: number, col: number): string {
    void this.localeTick;
    return t("cell.title", { row, col });
  }

  tabLabel(index: number, boardSession: BoardSession): string {
    void this.localeTick;
    return sessionTabLabel(
      index,
      boardSession.p1,
      boardSession.p2,
      boardSession.state.moveHistory.length
    );
  }

  sessionTabStatus(boardSession: BoardSession): string {
    if (boardSession.state.winner !== null) {
      return "restarting";
    }
    return boardSession.busy ? "thinking" : "idle";
  }

  boardOptions(): number[] {
    const options: number[] = [];
    for (let n = 1; n <= this.maxBoardCount; n += 1) {
      options.push(n);
    }
    return options;
  }

  boardOptionLabel(n: number): string {
    void this.localeTick;
    return t("boards.n", { n });
  }

  async init(): Promise<void> {
    // logger.setDebug(true);
    document.documentElement.style.setProperty("--cell-size", `${CELL_SIZE_PX}px`);

    this.maxBoardCount = maxTournamentBoards(detectHardwareConcurrency());
    this.boardCount = Math.min(DEFAULT_TOURNAMENT_BOARD_COUNT, this.maxBoardCount);

    this.unsubPop = installPopstateListener();
    this.settings = loadSettings();
    this.applyLang(this.settings.lang);
    const url = hydrateFromUrl();
    this.mode = url.mode;

    this.unsubUrl = subscribe((next, prev) => {
      if (next.mode !== prev.mode) {
        this.resetForMode(next.mode).catch((error: unknown) => {
          logger.error(error);
        });
      }
    });

    if (isMultiAiMode(url.mode)) {
      await this.resetForMode(url.mode);
      this.ready = true;
      return;
    }

    try {
      const loaded = await this.fetchState();
      try {
        const rebuilt = rebuildHistory(loaded);
        this.state = rebuilt.current;
        this.past = rebuilt.past;
        this.future = rebuilt.future;
      } catch {
        this.state = loaded;
        this.past = [];
        this.future = [];
      }
    } catch {
      this.setServerUnavailableNotice();
      this.state = newGame();
      this.past = [];
      this.future = [];
    }
    this.patternStore = PatternStore.fromBoard(this.state.board);
    this.resizePool(desiredPoolSize(this.boardCount));
    this.ready = true;
    await this.advanceIfAiTurn();
  }

  destroy(): void {
    this.unsubUrl?.();
    this.unsubPop?.();
    this.pool.terminate();
  }

  setMode(mode: GameMode): void {
    setUrlState({ mode });
  }

  setLang(lang: string): void {
    if (!isLocale(lang)) {
      return;
    }
    this.settings = { ...this.settings, lang };
    saveSettings(this.settings);
    this.applyLang(lang);
  }

  private applyLang(lang: "en" | "vi"): void {
    setLocale(lang);
    document.documentElement.lang = lang;
    this.lang = lang;
    this.localeTick += 1;
  }

  setDifficulty(value: Difficulty): void {
    this.difficulty = value;
  }

  setBoardCount(count: number): void {
    this.boardCount = count;
    if (isMultiAiMode(this.mode)) {
      this.resetForMode(this.mode, true).catch((error: unknown) => {
        logger.error(error);
      });
    }
  }

  setHighlightWhileThinking(value: boolean): void {
    this.settings = { ...this.settings, highlightWhileThinking: value };
    saveSettings(this.settings);
    if (!this.settings.highlightWhileThinking) {
      this.thinkingCell = null;
    }
  }

  setShowThoughts(value: boolean): void {
    this.settings = { ...this.settings, showThoughts: value };
    saveSettings(this.settings);
  }

  setExperienceImprovement(value: boolean): void {
    this.settings = { ...this.settings, experienceImprovement: value };
    saveSettings(this.settings);
  }

  setPracticeImprovement(value: boolean): void {
    this.settings = { ...this.settings, practiceImprovement: value };
    saveSettings(this.settings);
  }

  setSettleGiveUpSearches(value: number): void {
    const clamped = Math.min(9, Math.max(1, Math.round(value)));
    this.settings = { ...this.settings, settleGiveUpSearches: clamped };
    saveSettings(this.settings);
  }

  toggleAscii(): void {
    this.asciiOpen = !this.asciiOpen;
  }

  /** Begin running the idle multi-AI boards set up on mode entry. */
  start(): void {
    if (!isMultiAiMode(this.mode) || this.started) {
      return;
    }
    this.started = true;
    this.startAllSessionLoops();
  }

  togglePause(): void {
    if (!isMultiAiMode(this.mode)) {
      return;
    }
    this.autoplayPaused = !this.autoplayPaused;
    if (!this.autoplayPaused) {
      this.startAllSessionLoops();
    }
  }

  selectBoard(index: number): void {
    this.viewingResults = false;
    this.viewingReports = false;
    this.activeIndex = index;
  }

  selectResults(): void {
    if (!isTournamentMode(this.mode)) {
      return;
    }
    this.viewingResults = true;
  }

  selectReports(): void {
    if (this.mode !== "practice") {
      return;
    }
    this.viewingReports = true;
  }

  async newGame(): Promise<void> {
    if (isTournamentMode(this.mode)) {
      await this.clearResults();
    }
    if (this.mode === "practice") {
      this.clearReport();
    }
    await this.resetForMode(this.mode, true);
  }

  async playCell(row: number, col: number): Promise<void> {
    if (this.busy || this.state.nextPlayer !== this.humanPlayer || this.state.winner !== null) {
      return;
    }
    if (this.state.board[row][col] !== 0) {
      return;
    }

    const player = this.state.nextPlayer;
    const humanMove = { row, col };
    await this.commitAndSave(applyMove(this.state, humanMove, player), {
      move: humanMove,
      player,
    });
    await this.advanceIfAiTurn();
  }

  async undo(): Promise<void> {
    if (!this.canUndo) {
      return;
    }
    this.stepHistory("past", this.past.length >= 2 ? 2 : 1);
    try {
      await this.saveState(this.persistedState());
    } catch (error) {
      logger.error(error);
    }
  }

  async redo(): Promise<void> {
    if (!this.canRedo) {
      return;
    }
    this.stepHistory("future", this.future.length >= 2 ? 2 : 1);
    try {
      await this.saveState(this.persistedState());
    } catch (error) {
      logger.error(error);
    }
  }

  private persistedState(): GameState {
    const redoMoves =
      this.future.length > 0 ? this.future[0].moveHistory.slice(this.state.moveHistory.length) : [];
    return { ...this.state, redoMoves };
  }

  private difficultyLabel(difficulty: Difficulty): string {
    if (difficulty === "easy") {
      return t("difficulty.easy");
    }
    if (difficulty === "medium") {
      return t("difficulty.medium");
    }
    if (difficulty === "hard") {
      return t("difficulty.hard");
    }
    return t("difficulty.expert");
  }

  private statusText(current: GameState): string {
    if (current.winner === "draw") {
      return t("status.draw");
    }
    const human = this.humanPlayer;
    if (current.winner !== null) {
      if (human !== null) {
        return current.winner === human ? t("status.youWin") : t("status.aiWins");
      }
      return t("status.playerAiWins", { player: current.winner });
    }
    if (human !== null) {
      return current.nextPlayer === human ? t("status.yourTurn") : t("status.aiThinking");
    }
    return this.autoplayPaused
      ? t("status.paused")
      : t("status.playerAiThinking", { player: current.nextPlayer });
  }

  private setServerRetryNotice(attempt: number, maxAttempts: number): void {
    this.serverNotice = {
      key: "status.serverRetry",
      params: { attempt, max: maxAttempts },
    };
  }

  private setServerUnavailableNotice(): void {
    this.serverNotice = { key: "status.serverUnavailable", error: true };
  }

  private clearServerNotice(): void {
    this.serverNotice = null;
  }

  private clearThinkingHighlight(): void {
    this.thinkingCell = null;
  }

  private clearThoughtFeed(): void {
    this.thoughtLines = [];
    this.clearThinkingHighlight();
  }

  private appendThought(event: SearchProgressEvent): void {
    this.thoughtLines = [...this.thoughtLines, formatThought(event)];
    if (
      this.settings.highlightWhileThinking &&
      (event.type === "examining" ||
        event.type === "insight" ||
        event.type === "bestSoFar" ||
        event.type === "experienceHit")
    ) {
      this.thinkingCell = { row: event.row, col: event.col };
    }
  }

  private apiRetryHandler = (attempt: number, maxAttempts: number): void => {
    this.setServerRetryNotice(attempt, maxAttempts);
  };

  private async fetchState(): Promise<GameState> {
    const response = await fetchWithRetry(STATE_URL, undefined, { onRetry: this.apiRetryHandler });
    this.clearServerNotice();
    return deserializeState(await response.text());
  }

  private async saveState(next: GameState): Promise<void> {
    try {
      await fetchWithRetry(
        STATE_URL,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: serializeState(next),
        },
        { onRetry: this.apiRetryHandler }
      );
      this.clearServerNotice();
    } catch (error) {
      this.setServerUnavailableNotice();
      throw error;
    }
  }

  private syncPatternStore(prev: GameState, next: GameState): void {
    const prevLen = prev.moveHistory.length;
    const nextLen = next.moveHistory.length;
    if (nextLen === prevLen) {
      this.patternStore.resetFromBoard(next.board);
      return;
    }

    if (nextLen < prevLen) {
      const steps = prevLen - nextLen;
      if (this.patternStore.depth >= steps) {
        for (let i = 0; i < steps; i += 1) {
          this.patternStore.undo();
        }
        return;
      }
      this.patternStore.resetFromBoard(next.board);
      return;
    }

    const added = next.moveHistory.slice(prevLen);
    for (const move of added) {
      const cell = next.board[move.row][move.col];
      if (cell !== 1 && cell !== 2) {
        this.patternStore.resetFromBoard(next.board);
        return;
      }
      if (this.patternStore.board[move.row][move.col] !== 0) {
        this.patternStore.resetFromBoard(next.board);
        return;
      }
      this.patternStore.place(move, cell);
    }
  }

  private commitState(next: GameState, placed?: { move: Move; player: Player }): void {
    this.past = [...this.past, cloneState(this.state)];
    this.future = [];
    this.state = next;
    if (placed) {
      this.patternStore.place(placed.move, placed.player);
    } else {
      this.patternStore.resetFromBoard(next.board);
    }
  }

  private async commitAndSave(
    next: GameState,
    placed: { move: Move; player: Player }
  ): Promise<void> {
    this.commitState(next, placed);
    this.recordHumanWinIfNeeded(next);
    try {
      await this.saveState(this.persistedState());
    } catch (error) {
      logger.error(error);
    }
  }

  /** On a human win, seed the shared (cross-difficulty) human book with every
   * move the human made this game so any AI can later mimic them. Gated by the
   * same "experience improvement" toggle that governs difficulty-book writes;
   * losses and draws record nothing. */
  private recordHumanWinIfNeeded(next: GameState): void {
    const human = this.humanPlayer;
    if (human === null || next.winner !== human || !this.settings.experienceImprovement) {
      return;
    }
    for (const { key, move } of humanWinBookEntries(next.moveHistory, human)) {
      this.experienceStore.putHuman(key, { move, score: 0, depth: MIN_EXPERIENCE_DEPTH });
    }
  }

  private resizePool(targetSize: number): void {
    if (this.pool.size === targetSize) {
      return;
    }
    this.pool.terminate();
    this.pool = new EnginePool(targetSize, this.experienceStore, this.reportSink);
  }

  /** Append one report line to its board's rolling thoughts-area feed. No-op for
   *  background reports (no boardId). Newest last, capped. */
  private appendBoardReport(event: PracticeReportEvent): void {
    if (event.boardId === undefined) {
      return;
    }
    const prior = this.boardReportLines[event.boardId] ?? [];
    const next = [...prior, formatReportLine(event)].slice(-BOARD_REPORT_FEED_CAP);
    this.boardReportLines = { ...this.boardReportLines, [event.boardId]: next };
  }

  private countBookEntries(): number {
    return (["easy", "medium", "hard", "expert"] as const).reduce(
      (sum, difficulty) => sum + this.experienceStore.book(difficulty).size,
      0
    );
  }

  private scheduleReportSave(): void {
    if (this.reportSaveTimer !== null) {
      clearTimeout(this.reportSaveTimer);
    }
    this.reportSaveTimer = setTimeout(() => {
      this.reportSaveTimer = null;
      savePracticeReport(this.reportCounts, this.reportEvents);
    }, 250);
  }

  private loadReport(): void {
    const { counts, events } = loadPracticeReport();
    this.reportCounts = counts;
    this.reportEvents = events;
    this.bookEntryCount = this.countBookEntries();
  }

  private clearReport(): void {
    if (this.reportSaveTimer !== null) {
      clearTimeout(this.reportSaveTimer);
      this.reportSaveTimer = null;
    }
    this.reportCounts = { ...EMPTY_REPORT_COUNTS };
    this.reportEvents = [];
    this.boardReportLines = {};
    this.bookEntryCount = this.countBookEntries();
    clearPracticeReport();
  }

  private async runAiMove(): Promise<void> {
    if (this.state.winner !== null) {
      return;
    }
    const myGeneration = this.generation;
    this.busy = true;
    this.clearThoughtFeed();
    await delay(AI_THINK_DELAY_MS);
    if (myGeneration !== this.generation) {
      return;
    }
    const player = this.state.nextPlayer;
    let move: Move;
    try {
      move = (
        await this.pool.requestMove(this.state.board, player, this.difficulty, undefined, {
          experienceMode: this.experienceMode(),
          persistExperience: this.persistExperience(),
          settleGiveUpSearches: this.settings.settleGiveUpSearches,
          onProgress: event => {
            if (myGeneration !== this.generation) {
              return;
            }
            this.appendThought(event);
          },
        })
      ).move;
    } catch (error) {
      this.clearThoughtFeed();
      if (error instanceof CancelledError || myGeneration !== this.generation) {
        return;
      }
      this.busy = false;
      throw error;
    }
    if (myGeneration !== this.generation) {
      this.clearThoughtFeed();
      return;
    }
    this.busy = false;
    this.clearThinkingHighlight();
    await this.commitAndSave(applyMove(this.state, move, player), { move, player });
  }

  private async advanceIfAiTurn(): Promise<void> {
    if (this.state.winner !== null) {
      return;
    }
    if (this.state.nextPlayer !== this.humanPlayer) {
      await this.runAiMove();
    }
  }

  private createSession(p1: TournamentDifficulty, p2: TournamentDifficulty): BoardSession {
    const boardSession: BoardSession = {
      id: this.sessionIdCounter,
      state: newGame(),
      p1,
      p2,
      busy: false,
      gameStartMs: Date.now(),
      gamesPlayed: 0,
      loopRunning: false,
      cacheMissStreak: 0,
    };
    this.sessionIdCounter += 1;
    return boardSession;
  }

  private startTournament(count: number): void {
    this.sessions = Array.from({ length: count }, () => {
      const [p1, p2] = pairingAt(this.pairingCounter);
      this.pairingCounter += 1;
      return this.createSession(p1, p2);
    });
    this.activeIndex = 0;
  }

  private async postResult(boardSession: BoardSession, winner: 1 | 2 | "draw"): Promise<void> {
    const result: GameResult = {
      p1: boardSession.p1,
      p2: boardSession.p2,
      winner,
      moves: boardSession.state.moveHistory.length,
      durationMs: Date.now() - boardSession.gameStartMs,
      endedAt: new Date().toISOString(),
    };
    try {
      await fetchWithRetry(
        RESULTS_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        },
        { onRetry: this.apiRetryHandler }
      );
      this.clearServerNotice();
    } catch (error) {
      logger.error(error);
      this.setServerUnavailableNotice();
    }
    await this.refreshStats();
  }

  private async refreshStats(): Promise<void> {
    try {
      const response = await fetchWithRetry(RESULTS_URL, undefined, {
        onRetry: this.apiRetryHandler,
      });
      this.gameResults = (await response.json()) as GameResult[];
      this.clearServerNotice();
    } catch (error) {
      logger.error(error);
      this.setServerUnavailableNotice();
    }
  }

  private async clearResults(): Promise<void> {
    try {
      await fetchWithRetry(RESULTS_URL, { method: "DELETE" }, { onRetry: this.apiRetryHandler });
      this.clearServerNotice();
    } catch (error) {
      logger.error(error);
      this.setServerUnavailableNotice();
    }
    this.gameResults = [];
  }

  private async runSessionAiMove(boardSession: BoardSession, myGeneration: number): Promise<void> {
    boardSession.busy = true;
    this.sessions = [...this.sessions];

    const player = boardSession.state.nextPlayer;
    const difficulty = player === 1 ? boardSession.p1 : boardSession.p2;
    let move: Move;
    let experienceCacheHit: boolean | undefined;
    let experienceStreakEligible: boolean | undefined;
    try {
      const result = await this.pool.requestMove(
        boardSession.state.board,
        player,
        difficulty,
        undefined,
        {
          experienceMode: this.experienceMode(),
          persistExperience: this.persistExperience(),
          practiceImprovement: this.settings.practiceImprovement,
          settleGiveUpSearches: this.settings.settleGiveUpSearches,
          reportBoardId: boardSession.id,
        }
      );
      move = result.move;
      experienceCacheHit = result.experienceCacheHit;
      experienceStreakEligible = result.experienceStreakEligible;
    } catch (error) {
      boardSession.busy = false;
      this.sessions = [...this.sessions];
      if (error instanceof CancelledError || myGeneration !== this.generation) {
        return;
      }
      throw error;
    }
    if (myGeneration !== this.generation) {
      return;
    }
    boardSession.busy = false;
    if (this.mode === "practice") {
      const streakBefore = boardSession.cacheMissStreak;
      const stoneCountBefore = boardSession.state.moveHistory.length;
      boardSession.cacheMissStreak = nextCacheMissStreak(
        boardSession.cacheMissStreak,
        experienceCacheHit,
        experienceStreakEligible
      );
      boardSession.lastPracticePly = {
        player,
        difficulty,
        move,
        experienceCacheHit,
        experienceStreakEligible,
        streakBefore,
        streakAfter: boardSession.cacheMissStreak,
        stoneCountBefore,
      };
    }
    boardSession.state = applyMove(boardSession.state, move, player);
    this.sessions = [...this.sessions];
  }

  private async runSessionLoop(boardSession: BoardSession): Promise<void> {
    if (boardSession.loopRunning) {
      return;
    }
    boardSession.loopRunning = true;
    const myGeneration = this.generation;
    try {
      while (myGeneration === this.generation && isMultiAiMode(this.mode) && !this.autoplayPaused) {
        const winner = boardSession.state.winner;
        const stoneCount = boardSession.state.moveHistory.length;
        const leftBook =
          this.mode === "practice" &&
          shouldRestartPracticeGame({
            cacheMissStreak: boardSession.cacheMissStreak,
            stoneCount,
          });
        if (winner !== null || leftBook) {
          if (leftBook) {
            logger.log("practice restart", {
              reason: "left-book",
              detail: "consecutive real-search cache misses with enough stones on board",
              boardId: boardSession.id,
              pairing: `${boardSession.p1}×${boardSession.p2}`,
              cacheMissStreak: boardSession.cacheMissStreak,
              stoneCount,
              lastPracticePly: boardSession.lastPracticePly,
              lastMoves: boardSession.state.moveHistory.slice(-6),
            });
          } else if (this.mode === "practice") {
            logger.log("practice restart", {
              reason: "game-over",
              winner,
              boardId: boardSession.id,
              pairing: `${boardSession.p1}×${boardSession.p2}`,
              stoneCount,
            });
          }
          if (winner !== null) {
            if (isTournamentMode(this.mode)) {
              await this.postResult(boardSession, winner);
              if (myGeneration !== this.generation) {
                return;
              }
            }
            await delay(GAME_END_PAUSE_MS);
            if (myGeneration !== this.generation) {
              return;
            }
          }
          const [p1, p2] = pairingAt(this.pairingCounter);
          this.pairingCounter += 1;
          boardSession.p1 = p1;
          boardSession.p2 = p2;
          boardSession.state = newGame();
          boardSession.cacheMissStreak = 0;
          boardSession.lastPracticePly = undefined;
          boardSession.gameStartMs = Date.now();
          boardSession.gamesPlayed += 1;
          this.sessions = [...this.sessions];
          continue;
        }
        await this.runSessionAiMove(boardSession, myGeneration);
        if (myGeneration !== this.generation) {
          return;
        }
        await delay(MOVE_RENDER_DELAY_MS);
      }
    } finally {
      boardSession.loopRunning = false;
    }
  }

  private startAllSessionLoops(): void {
    for (const boardSession of this.sessions) {
      this.runSessionLoop(boardSession).catch((error: unknown) => {
        logger.error(error);
      });
    }
  }

  private stepHistory(fromStack: "past" | "future", preferredSteps: number): void {
    const prev = this.state;
    const from = fromStack === "past" ? [...this.past] : [...this.future];
    const to = fromStack === "past" ? [...this.future] : [...this.past];
    const steps = Math.min(preferredSteps, from.length);
    let current = this.state;
    for (let i = 0; i < steps; i += 1) {
      to.push(cloneState(current));
      current = from.pop()!;
    }
    if (fromStack === "past") {
      this.past = from;
      this.future = to;
    } else {
      this.future = from;
      this.past = to;
    }
    this.state = current;
    this.syncPatternStore(prev, this.state);
  }

  /**
   * Rebuild state for `newMode`. On plain mode entry the multi-AI boards are
   * left idle until the Start button runs them; pass `resume` (from New Game or
   * a board-count change) to keep an already-running tournament going.
   */
  async resetForMode(newMode: GameMode, resume = false): Promise<void> {
    this.generation += 1;
    this.pool.cancelAll();
    this.clearThoughtFeed();
    this.mode = newMode;
    this.autoplayPaused = false;

    if (isMultiAiMode(newMode)) {
      this.resizePool(desiredPoolSize(this.boardCount));
      this.pairingCounter = 0;
      this.viewingResults = false;
      this.viewingReports = false;
      this.startTournament(this.boardCount);
      if (isTournamentMode(newMode)) {
        await this.refreshStats();
      } else {
        this.gameResults = [];
      }
      if (newMode === "practice") {
        this.loadReport();
      }
      if (resume && this.started) {
        this.startAllSessionLoops();
      } else {
        this.started = false;
      }
      return;
    }

    this.started = false;
    this.sessions = [];
    this.resizePool(desiredPoolSize(this.boardCount));
    this.busy = false;
    this.past = [];
    this.future = [];
    this.state = newGame();
    this.patternStore = PatternStore.fromBoard(this.state.board);
    try {
      await this.saveState(this.persistedState());
    } catch (error) {
      logger.error(error);
    }
    await this.advanceIfAiTurn();
  }
}

export const session = new GameSession();
setLocale(session.settings.lang);
if (typeof document !== "undefined") {
  document.documentElement.lang = session.settings.lang;
}

/** Re-export for components that need BOARD_SIZE without importing engine. */
export { BOARD_SIZE };
export type { Difficulty, GameMode, Move };
