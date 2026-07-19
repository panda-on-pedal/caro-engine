import { BOARD_SIZE, type Board, type Player } from '../engine/board.ts';
import { type Difficulty } from '../engine/engine.ts';
import { PatternStore } from '../engine/patternStore.ts';
import { applyMove, deserializeState, newGame, serializeState, type GameState, type Move } from '../engine/state.ts';
import type { GameResult, PairingStats } from '../shared/results.ts';
import { aggregateResults } from '../shared/results.ts';
import { logger } from '../utils/logger.ts';
import { CancelledError, EnginePool } from './enginePool.ts';
import { pairingAt, sessionTabLabel, TOURNAMENT_TIME_BUDGET_MS, type TournamentDifficulty } from './tournament.ts';

const STATE_URL = '/api/state';
const RESULTS_URL = '/api/results';
const AI_THINK_DELAY_MS = 300;
const CELL_SIZE_PX = 28;
/** How long a finished tournament board holds its win/draw message before
 * rotating to the next pairing — long enough to actually read it. */
const GAME_END_PAUSE_MS = 2000;

const statusEl = document.getElementById('status') as HTMLParagraphElement;
const tabStripEl = document.getElementById('tab-strip') as HTMLDivElement;
const boardGridEl = document.getElementById('board-grid') as HTMLDivElement;
const boardEl = document.getElementById('board') as HTMLDivElement;
const colHeadersEl = document.getElementById('col-headers') as HTMLDivElement;
const rowHeadersEl = document.getElementById('row-headers') as HTMLDivElement;
const statsPanelEl = document.getElementById('stats-panel') as HTMLDivElement;
const newGameButton = document.getElementById('new-game') as HTMLButtonElement;
const undoButton = document.getElementById('undo') as HTMLButtonElement;
const redoButton = document.getElementById('redo') as HTMLButtonElement;
const gameModeEl = document.getElementById('game-mode') as HTMLSelectElement;
const difficultyEl = document.getElementById('difficulty') as HTMLSelectElement;
const boardCountEl = document.getElementById('board-count') as HTMLSelectElement;
const pauseButton = document.getElementById('pause') as HTMLButtonElement;
const asciiToggleButton = document.getElementById('ascii-toggle') as HTMLButtonElement;
const asciiPanelEl = document.getElementById('ascii-panel') as HTMLDivElement;
const asciiTextEl = document.getElementById('ascii-text') as HTMLTextAreaElement;

type GameMode = 'human-ai' | 'ai-human' | 'ai-ai';

/** One board's worth of ai-ai tournament state. Human modes (human-ai /
 * ai-human) never use this — they keep the single global `state` below. */
interface BoardSession {
  id: number;
  state: GameState;
  p1: TournamentDifficulty;
  p2: TournamentDifficulty;
  busy: boolean;
  gameStartMs: number;
  gamesPlayed: number;
  loopRunning: boolean;
}

let state: GameState = newGame();
/** Snapshots before each stone; undo pops one stone at a time. */
let past: GameState[] = [];
let future: GameState[] = [];
/** True while an AI reply is pending — blocks clicks / undo / redo. */
let busy = false;
/** Incremental pattern cache kept in sync with `state` (including undo/redo). */
let patternStore = PatternStore.fromBoard(state.board);
let mode: GameMode = 'human-ai';
/** ai-ai only: true while autoplay is paused (halts every board). */
let autoplayPaused = false;
/** Bumped on every reset; in-flight AI computations abort if it moves on
 * from under them (e.g. New Game / mode switch while the AI is thinking). */
let generation = 0;
let pool = new EnginePool(1);

/** ai-ai only, below. */
let sessions: BoardSession[] = [];
let activeIndex = 0;
/** True when the extra "Results" tab is selected instead of a board. */
let viewingResults = false;
let pairingCounter = 0;
let sessionIdCounter = 0;
let boardCount = Number(boardCountEl.value);
let pairingStats: PairingStats[] = aggregateResults([]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneState(current: GameState): GameState {
  return deserializeState(serializeState(current));
}

/** `state` plus the redo history derived from `future`, for persistence.
 * `future[0]` (bottom of the stack) always holds the full extended move
 * list, since `future` is appended to bottom-first as undos happen. */
function persistedState(): GameState {
  const redoMoves = future.length > 0 ? future[0].moveHistory.slice(state.moveHistory.length) : [];
  return { ...state, redoMoves };
}

/** Rebuilds the in-memory undo/redo stacks from a loaded GameState's
 * `moveHistory` (past) and `redoMoves` (future) by replaying moves through
 * `applyMove`, so history survives a page reload. */
function rebuildHistory(loaded: GameState): { current: GameState; past: GameState[]; future: GameState[] } {
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

/** The human's player number for the current mode, or `null` in ai-ai. */
function humanPlayer(): Player | null {
  if (mode === 'human-ai') {
    return 1;
  }
  if (mode === 'ai-human') {
    return 2;
  }
  return null;
}

/** Human-mode (human-ai / ai-human) difficulty — read from the single
 * shared select. ai-ai reads each board's own `session.p1`/`p2` instead. */
function currentDifficulty(): Difficulty {
  return difficultyEl.value as Difficulty;
}

function historyLocked(): boolean {
  return mode === 'ai-ai' && !autoplayPaused;
}

/** `Math.max(1, Math.min(count, cores - 1))` — caps worker concurrency at
 * physical parallelism so oversubscription doesn't silently shallow
 * searches (which would bias the win rates the tournament measures). */
function desiredPoolSize(count: number): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(count, cores - 1));
}

function resizePool(targetSize: number): void {
  if (pool.size === targetSize) {
    return;
  }
  pool.terminate();
  pool = new EnginePool(targetSize);
}

async function fetchState(): Promise<GameState> {
  const response = await fetch(STATE_URL);
  return deserializeState(await response.text());
}

async function saveState(next: GameState): Promise<void> {
  await fetch(STATE_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: serializeState(next),
  });
}

/** Small deterministic per-cell tilt so ink marks read as hand-drawn rather than printed. */
function inkTiltDegrees(row: number, col: number): number {
  const seed = (row * 928371 + col * 129871) % 7;
  return (seed - 3) * 2.5;
}

/** Debug aid: dumps both players' recognized patterns from the live cache. */
function logPatterns(): void {
  logger.log('[patterns] player 1 (X):', patternStore.patterns(1));
  logger.log('[patterns] player 2 (O):', patternStore.patterns(2));
}

/**
 * Keep `patternStore` aligned with a history jump (undo/redo). Prefers
 * place/undo when the stone delta matches the store stack; otherwise
 * rebuilds from the board so the cache never goes stale.
 */
function syncPatternStore(prev: GameState, next: GameState): void {
  const prevLen = prev.moveHistory.length;
  const nextLen = next.moveHistory.length;
  if (nextLen === prevLen) {
    patternStore.resetFromBoard(next.board);
    return;
  }

  if (nextLen < prevLen) {
    const steps = prevLen - nextLen;
    if (patternStore.depth >= steps) {
      for (let i = 0; i < steps; i += 1) {
        patternStore.undo();
      }
      return;
    }
    patternStore.resetFromBoard(next.board);
    return;
  }

  const added = next.moveHistory.slice(prevLen);
  for (const move of added) {
    const cell = next.board[move.row][move.col];
    if (cell !== 1 && cell !== 2) {
      patternStore.resetFromBoard(next.board);
      return;
    }
    if (patternStore.board[move.row][move.col] !== 0) {
      patternStore.resetFromBoard(next.board);
      return;
    }
    patternStore.place(move, cell);
  }
}

/** Renders the board as a fixed-width grid (col headers on top, row headers on
 * the left) cropped to the played stones plus one empty row/col of margin, so
 * a position can be read off and reconstructed for simulation. */
function boardToAscii(board: Board): string {
  const symbol = (cell: number): string => (cell === 1 ? 'X' : cell === 2 ? 'O' : '.');

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
    '   ' +
    Array.from({ length: endCol - startCol + 1 }, (_, i) => String(startCol + i).padStart(3)).join('');
  const rows: string[] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    let line = String(row).padStart(3);
    for (let col = startCol; col <= endCol; col += 1) {
      line += symbol(board[row][col]).padStart(3);
    }
    rows.push(line);
  }
  return [colHeader, ...rows].join('\n');
}

function statusText(current: GameState): string {
  if (current.winner === 'draw') {
    return "It's a draw!";
  }
  const human = humanPlayer();
  if (current.winner !== null) {
    if (human !== null) {
      return current.winner === human ? 'You win!' : 'AI wins!';
    }
    return `Player ${current.winner} (AI) wins!`;
  }
  if (human !== null) {
    return current.nextPlayer === human ? 'Your turn' : 'AI thinking…';
  }
  return autoplayPaused ? 'Paused' : `Player ${current.nextPlayer} (AI) thinking…`;
}

/** The board currently shown in the DOM: the active tournament session in
 * ai-ai, otherwise the single global `state`. */
function activeGameState(): GameState {
  if (mode === 'ai-ai') {
    return sessions[activeIndex]?.state ?? newGame();
  }
  return state;
}

function activeBusy(): boolean {
  if (mode === 'ai-ai') {
    return sessions[activeIndex]?.busy ?? false;
  }
  return busy;
}

function updateHistoryButtons(): void {
  const isAiAi = mode === 'ai-ai';
  undoButton.hidden = isAiAi;
  redoButton.hidden = isAiAi;
  const locked = historyLocked();
  undoButton.disabled = busy || locked || past.length === 0;
  redoButton.disabled = busy || locked || future.length === 0;
}

function render(): void {
  const showingResults = mode === 'ai-ai' && viewingResults;
  boardGridEl.hidden = showingResults;
  statsPanelEl.hidden = !showingResults;
  if (showingResults) {
    statusEl.textContent = 'Tournament results';
    delete statusEl.dataset.done;
    updateHistoryButtons();
    return;
  }

  const current = activeGameState();
  const isBusy = activeBusy();

  statusEl.textContent = statusText(current);
  if (current.winner === null) {
    delete statusEl.dataset.done;
  } else {
    statusEl.dataset.done = 'true';
  }

  const lastMove = current.moveHistory[current.moveHistory.length - 1] as Move | undefined;
  const winningCells = new Set((current.winningLine ?? []).map((move) => `${move.row},${move.col}`));

  const cells = boardEl.children;
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = cells[row * BOARD_SIZE + col] as HTMLButtonElement;
      const mark = cell.firstElementChild as HTMLSpanElement;
      const value = current.board[row][col];
      mark.textContent = value === 1 ? 'X' : value === 2 ? 'O' : '';
      if (value === 0) {
        delete cell.dataset.player;
        cell.style.transform = '';
      } else {
        cell.dataset.player = String(value);
        cell.style.transform = `rotate(${inkTiltDegrees(row, col)}deg)`;
      }
      cell.disabled =
        isBusy || value !== 0 || current.nextPlayer !== humanPlayer() || current.winner !== null;

      if (lastMove && lastMove.row === row && lastMove.col === col) {
        mark.dataset.lastMove = 'true';
      } else {
        delete mark.dataset.lastMove;
      }

      if (winningCells.has(`${row},${col}`)) {
        mark.dataset.winningCell = 'true';
      } else {
        delete mark.dataset.winningCell;
      }
    }
  }
  updateHistoryButtons();
  asciiTextEl.value = boardToAscii(current.board);
}

function buildHeaderStrip(container: HTMLDivElement, axis: 'row' | 'col'): void {
  container.innerHTML = '';
  if (axis === 'col') {
    container.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, var(--cell-size))`;
  } else {
    container.style.gridTemplateRows = `repeat(${BOARD_SIZE}, var(--cell-size))`;
  }
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const label = document.createElement('div');
    label.className = 'header-cell';
    label.textContent = String(i);
    fragment.appendChild(label);
  }
  container.appendChild(fragment);
}

function buildBoard(): void {
  document.documentElement.style.setProperty('--cell-size', `${CELL_SIZE_PX}px`);

  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, var(--cell-size))`;
  boardEl.style.gridTemplateRows = `repeat(${BOARD_SIZE}, var(--cell-size))`;
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.title = `Row ${row}, Col ${col}`;

      const mark = document.createElement('span');
      mark.className = 'mark';
      cell.appendChild(mark);

      fragment.appendChild(cell);
    }
  }
  boardEl.appendChild(fragment);

  buildHeaderStrip(colHeadersEl, 'col');
  buildHeaderStrip(rowHeadersEl, 'row');
}

/** Push current board, apply `next`, clear redo stack, update pattern cache. */
function commitState(
  next: GameState,
  placed?: { move: Move; player: Player },
): void {
  past.push(cloneState(state));
  future = [];
  state = next;
  if (placed) {
    patternStore.place(placed.move, placed.player);
  } else {
    patternStore.resetFromBoard(next.board);
  }
}

/** Commit a move, render, and persist — the single path every move (human
 * click or AI reply) funnels through so saved state is always current. */
async function commitAndSave(
  next: GameState,
  placed: { move: Move; player: Player },
): Promise<void> {
  commitState(next, placed);
  render();
  logPatterns();
  await saveState(persistedState());
}

/** Runs one AI move for whichever player is currently on the clock. Aborts
 * without side effects if `generation` moves on during the think-delay or
 * the (now async, worker-backed) search itself — New Game / mode switch
 * fired mid-turn bumps `generation` and cancels the pool, and `resetForMode`
 * already restores `busy` in that case, so an aborted call must not touch it. */
async function runAiMove(): Promise<void> {
  if (state.winner !== null) {
    return;
  }
  const myGeneration = generation;
  busy = true;
  render();
  await delay(AI_THINK_DELAY_MS);
  if (myGeneration !== generation) {
    return;
  }
  const player = state.nextPlayer;
  let move: Move;
  try {
    move = (await pool.requestMove(state.board, player, currentDifficulty())).move;
  } catch (error) {
    if (error instanceof CancelledError || myGeneration !== generation) {
      return;
    }
    busy = false;
    render();
    throw error;
  }
  if (myGeneration !== generation) {
    return;
  }
  busy = false;
  await commitAndSave(applyMove(state, move, player), { move, player });
}

/** After any commit (or a reset), starts whatever should happen next given
 * the current mode and turn. Never called while `mode === 'ai-ai'` — that
 * path is driven entirely by per-session tournament loops instead. */
async function advanceIfAiTurn(): Promise<void> {
  if (state.winner !== null) {
    return;
  }
  if (state.nextPlayer !== humanPlayer()) {
    await runAiMove();
  }
}

function createSession(p1: TournamentDifficulty, p2: TournamentDifficulty): BoardSession {
  const session: BoardSession = {
    id: sessionIdCounter,
    state: newGame(),
    p1,
    p2,
    busy: false,
    gameStartMs: Date.now(),
    gamesPlayed: 0,
    loopRunning: false,
  };
  sessionIdCounter += 1;
  return session;
}

function startTournament(count: number): void {
  sessions = Array.from({ length: count }, () => {
    const [p1, p2] = pairingAt(pairingCounter);
    pairingCounter += 1;
    return createSession(p1, p2);
  });
  activeIndex = 0;
}

async function postResult(session: BoardSession, winner: 1 | 2 | 'draw'): Promise<void> {
  const result: GameResult = {
    p1: session.p1,
    p2: session.p2,
    winner,
    moves: session.state.moveHistory.length,
    durationMs: Date.now() - session.gameStartMs,
    endedAt: new Date().toISOString(),
  };
  try {
    await fetch(RESULTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
  } catch (error) {
    logger.error(error);
  }
  await refreshStats();
}

async function refreshStats(): Promise<void> {
  try {
    const response = await fetch(RESULTS_URL);
    const records = (await response.json()) as GameResult[];
    pairingStats = aggregateResults(records);
  } catch (error) {
    logger.error(error);
  }
  renderStats();
}

function renderStats(): void {
  if (mode !== 'ai-ai') {
    statsPanelEl.innerHTML = '';
    return;
  }
  const rows = pairingStats
    .map(
      (row) =>
        `<tr><td>${row.p1}×${row.p2}</td><td>${row.games}</td><td>${row.p1Wins}</td>` +
        `<td>${row.p2Wins}</td><td>${row.draws}</td>` +
        `<td>${row.games === 0 ? '—' : row.p1WinPct.toFixed(1) + '%'}</td>` +
        `<td>${row.games === 0 ? '—' : `${row.avgP1Moves.toFixed(1)} / ${row.avgP2Moves.toFixed(1)}`}</td></tr>`,
    )
    .join('');
  statsPanelEl.innerHTML =
    '<table><thead><tr><th>Pairing</th><th>Games</th><th>P1 wins</th><th>P2 wins</th>' +
    '<th>Draws</th><th>P1 win%</th><th>Avg moves (P1 / P2)</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>`;
}

function renderTabs(): void {
  const isAiAi = mode === 'ai-ai';
  tabStripEl.hidden = !isAiAi;
  tabStripEl.innerHTML = '';
  if (!isAiAi) {
    return;
  }
  const fragment = document.createDocumentFragment();
  sessions.forEach((session, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab-button';
    button.textContent = sessionTabLabel(index, session.p1, session.p2, session.state.moveHistory.length);
    button.dataset.status = session.state.winner !== null ? 'restarting' : session.busy ? 'thinking' : 'idle';
    if (!viewingResults && index === activeIndex) {
      button.dataset.active = 'true';
    }
    button.addEventListener('click', () => {
      viewingResults = false;
      activeIndex = index;
      render();
      renderTabs();
    });
    fragment.appendChild(button);
  });

  const resultsButton = document.createElement('button');
  resultsButton.type = 'button';
  resultsButton.className = 'tab-button tab-button-results';
  resultsButton.textContent = 'Results';
  if (viewingResults) {
    resultsButton.dataset.active = 'true';
  }
  resultsButton.addEventListener('click', () => {
    viewingResults = true;
    render();
    renderTabs();
  });
  fragment.appendChild(resultsButton);

  tabStripEl.appendChild(fragment);
}

/** Runs one AI move for `session`. Mirrors `runAiMove`'s cancellation
 * handling but keys everything off the session rather than the global
 * `state`/`busy`, and skips the human-facing think-delay (tournament games
 * run at full worker speed). */
async function runSessionAiMove(session: BoardSession, myGeneration: number): Promise<void> {
  session.busy = true;
  if (sessions[activeIndex] === session) {
    render();
  }
  renderTabs();

  const player = session.state.nextPlayer;
  const difficulty = player === 1 ? session.p1 : session.p2;
  let move: Move;
  try {
    move = (
      await pool.requestMove(session.state.board, player, difficulty, TOURNAMENT_TIME_BUDGET_MS[difficulty])
    ).move;
  } catch (error) {
    session.busy = false;
    if (error instanceof CancelledError || myGeneration !== generation) {
      return;
    }
    if (sessions[activeIndex] === session) {
      render();
    }
    throw error;
  }
  if (myGeneration !== generation) {
    return;
  }
  session.busy = false;
  session.state = applyMove(session.state, move, player);
  if (sessions[activeIndex] === session) {
    render();
  }
  renderTabs();
}

/** Drives one board through repeated games: plays moves until a game ends,
 * posts the result, rotates to the next pairing, and repeats — until
 * paused, reset (generation bump), or the mode changes away from ai-ai.
 * Safe to call on an already-running session (no-op via `loopRunning`). */
async function runSessionLoop(session: BoardSession): Promise<void> {
  if (session.loopRunning) {
    return;
  }
  session.loopRunning = true;
  const myGeneration = generation;
  try {
    while (myGeneration === generation && mode === 'ai-ai' && !autoplayPaused) {
      const winner = session.state.winner;
      if (winner !== null) {
        await postResult(session, winner);
        if (myGeneration !== generation) {
          return;
        }
        // Hold the finished board on screen (win/draw message still showing
        // via statusText) before rotating to the next pairing.
        await delay(GAME_END_PAUSE_MS);
        if (myGeneration !== generation) {
          return;
        }
        const [p1, p2] = pairingAt(pairingCounter);
        pairingCounter += 1;
        session.p1 = p1;
        session.p2 = p2;
        session.state = newGame();
        session.gameStartMs = Date.now();
        session.gamesPlayed += 1;
        renderTabs();
        if (sessions[activeIndex] === session) {
          render();
        }
        continue;
      }
      await runSessionAiMove(session, myGeneration);
    }
  } finally {
    session.loopRunning = false;
  }
}

function startAllSessionLoops(): void {
  for (const session of sessions) {
    runSessionLoop(session).catch((error: unknown) => {
      logger.error(error);
    });
  }
}

function togglePause(): void {
  if (mode !== 'ai-ai') {
    return;
  }
  autoplayPaused = !autoplayPaused;
  updateModeUI();
  render();
  if (!autoplayPaused) {
    startAllSessionLoops();
  }
}

function updateModeUI(): void {
  const isAiAi = mode === 'ai-ai';
  gameModeEl.value = mode;
  difficultyEl.hidden = isAiAi;
  boardCountEl.hidden = !isAiAi;
  pauseButton.hidden = !isAiAi;
  pauseButton.textContent = autoplayPaused ? 'Resume' : 'Pause';
}

/** Starts a fresh game (or, for ai-ai, a fresh tournament) under `newMode`.
 * Safe to call mid-AI-think — bumping `generation` orphans any in-flight
 * computation for the old game/tournament, and `pool.cancelAll()` kills any
 * search actually running in a worker. Also used to restart the tournament
 * in place when the board count changes. */
async function resetForMode(newMode: GameMode): Promise<void> {
  generation += 1;
  pool.cancelAll();
  mode = newMode;
  autoplayPaused = false;

  if (newMode === 'ai-ai') {
    resizePool(desiredPoolSize(boardCount));
    pairingCounter = 0;
    viewingResults = false;
    startTournament(boardCount);
    updateModeUI();
    render();
    renderTabs();
    await refreshStats();
    startAllSessionLoops();
    return;
  }

  sessions = [];
  resizePool(1);
  busy = false;
  past = [];
  future = [];
  state = newGame();
  patternStore = PatternStore.fromBoard(state.board);
  updateModeUI();
  render();
  renderTabs();
  await saveState(persistedState());
  await advanceIfAiTurn();
}

async function handleCellClick(event: MouseEvent): Promise<void> {
  if (busy || state.nextPlayer !== humanPlayer() || state.winner !== null) {
    return;
  }

  const target = (event.target as HTMLElement).closest('.cell');
  if (!(target instanceof HTMLButtonElement) || target.disabled || !target.dataset.row || !target.dataset.col) {
    return;
  }

  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);
  const player = state.nextPlayer;
  const humanMove = { row, col };

  await commitAndSave(applyMove(state, humanMove, player), { move: humanMove, player });
  await advanceIfAiTurn();
}

/** Undo/redo one full human turn when possible (human stone + AI reply),
 * so after undo it is player 1's turn again. Falls back to a single step
 * when only one snapshot exists (e.g. human just won before the AI moved). */
function stepHistory(from: GameState[], to: GameState[], preferredSteps: number): void {
  const prev = state;
  const steps = Math.min(preferredSteps, from.length);
  for (let i = 0; i < steps; i += 1) {
    to.push(cloneState(state));
    state = from.pop()!;
  }
  syncPatternStore(prev, state);
}

async function handleUndo(): Promise<void> {
  if (busy || historyLocked() || past.length === 0) {
    return;
  }
  stepHistory(past, future, past.length >= 2 ? 2 : 1);
  render();
  logPatterns();
  await saveState(persistedState());
}

async function handleRedo(): Promise<void> {
  if (busy || historyLocked() || future.length === 0) {
    return;
  }
  stepHistory(future, past, future.length >= 2 ? 2 : 1);
  render();
  logPatterns();
  await saveState(persistedState());
}

async function init(): Promise<void> {
  logger.setDebug(true);
  buildBoard();

  try {
    const loaded = await fetchState();
    try {
      const rebuilt = rebuildHistory(loaded);
      state = rebuilt.current;
      past = rebuilt.past;
      future = rebuilt.future;
    } catch {
      state = loaded;
      past = [];
      future = [];
    }
  } catch {
    state = newGame();
    past = [];
    future = [];
  }
  patternStore = PatternStore.fromBoard(state.board);
  updateModeUI();
  render();

  boardEl.addEventListener('click', (event) => {
    handleCellClick(event).catch((error: unknown) => {
      logger.error(error);
    });
  });

  undoButton.addEventListener('click', () => {
    handleUndo().catch((error: unknown) => {
      logger.error(error);
    });
  });

  redoButton.addEventListener('click', () => {
    handleRedo().catch((error: unknown) => {
      logger.error(error);
    });
  });

  newGameButton.addEventListener('click', () => {
    resetForMode(mode).catch((error: unknown) => {
      logger.error(error);
    });
  });

  gameModeEl.addEventListener('change', () => {
    resetForMode(gameModeEl.value as GameMode).catch((error: unknown) => {
      logger.error(error);
    });
  });

  boardCountEl.addEventListener('change', () => {
    boardCount = Number(boardCountEl.value);
    if (mode === 'ai-ai') {
      resetForMode('ai-ai').catch((error: unknown) => {
        logger.error(error);
      });
    }
  });

  pauseButton.addEventListener('click', () => {
    togglePause();
  });

  asciiToggleButton.addEventListener('click', () => {
    asciiPanelEl.hidden = !asciiPanelEl.hidden;
    asciiToggleButton.textContent = asciiPanelEl.hidden ? 'Show ASCII' : 'Hide ASCII';
  });

  await advanceIfAiTurn();
}

init().catch((error: unknown) => {
  logger.error(error);
});
