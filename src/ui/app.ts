import { BOARD_SIZE, type Board, type Player } from '../engine/board.ts';
import { chooseMove, type Difficulty } from '../engine/engine.ts';
import { PatternStore } from '../engine/patternStore.ts';
import { applyMove, deserializeState, newGame, serializeState, type GameState, type Move } from '../engine/state.ts';
import { logger } from '../utils/logger.ts';

const STATE_URL = '/api/state';
const AI_THINK_DELAY_MS = 300;
const CELL_SIZE_PX = 28;

const statusEl = document.getElementById('status') as HTMLParagraphElement;
const boardEl = document.getElementById('board') as HTMLDivElement;
const colHeadersEl = document.getElementById('col-headers') as HTMLDivElement;
const rowHeadersEl = document.getElementById('row-headers') as HTMLDivElement;
const newGameButton = document.getElementById('new-game') as HTMLButtonElement;
const undoButton = document.getElementById('undo') as HTMLButtonElement;
const redoButton = document.getElementById('redo') as HTMLButtonElement;
const difficultyEl = document.getElementById('difficulty') as HTMLSelectElement;
const asciiToggleButton = document.getElementById('ascii-toggle') as HTMLButtonElement;
const asciiPanelEl = document.getElementById('ascii-panel') as HTMLDivElement;
const asciiTextEl = document.getElementById('ascii-text') as HTMLTextAreaElement;

let state: GameState = newGame();
/** Snapshots before each stone; undo pops one stone at a time. */
let past: GameState[] = [];
let future: GameState[] = [];
/** True while the AI reply is pending — blocks clicks / undo / redo. */
let busy = false;
/** Incremental pattern cache kept in sync with `state` (including undo/redo). */
let patternStore = PatternStore.fromBoard(state.board);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneState(current: GameState): GameState {
  return deserializeState(serializeState(current));
}

function currentDifficulty(): Difficulty {
  return difficultyEl.value as Difficulty;
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
  if (current.winner === 1) {
    return 'You win!';
  }
  if (current.winner === 2) {
    return 'AI wins!';
  }
  if (current.winner === 'draw') {
    return "It's a draw!";
  }
  return current.nextPlayer === 1 ? 'Your turn' : 'AI thinking…';
}

function updateHistoryButtons(): void {
  undoButton.disabled = busy || past.length === 0;
  redoButton.disabled = busy || future.length === 0;
}

function render(): void {
  statusEl.textContent = statusText(state);
  if (state.winner === null) {
    delete statusEl.dataset.done;
  } else {
    statusEl.dataset.done = 'true';
  }

  const cells = boardEl.children;
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = cells[row * BOARD_SIZE + col] as HTMLButtonElement;
      const value = state.board[row][col];
      cell.textContent = value === 1 ? 'X' : value === 2 ? 'O' : '';
      if (value === 0) {
        delete cell.dataset.player;
        cell.style.transform = '';
      } else {
        cell.dataset.player = String(value);
        cell.style.transform = `rotate(${inkTiltDegrees(row, col)}deg)`;
      }
      cell.disabled =
        busy || value !== 0 || state.nextPlayer !== 1 || state.winner !== null;
    }
  }
  updateHistoryButtons();
  asciiTextEl.value = boardToAscii(state.board);
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

async function handleCellClick(event: MouseEvent): Promise<void> {
  if (busy || state.nextPlayer !== 1 || state.winner !== null) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || target.disabled || !target.dataset.row || !target.dataset.col) {
    return;
  }

  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);

  const humanMove = { row, col };
  commitState(applyMove(state, humanMove, 1), { move: humanMove, player: 1 });
  render();
  logPatterns();

  if (state.winner === null) {
    busy = true;
    render();
    await delay(AI_THINK_DELAY_MS);
    const aiMove = chooseMove(state, { difficulty: currentDifficulty() }).move;
    commitState(applyMove(state, aiMove, 2), { move: aiMove, player: 2 });
    busy = false;
  }
  render();
  logPatterns();

  await saveState(state);
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
  if (busy || past.length === 0) {
    return;
  }
  stepHistory(past, future, past.length >= 2 ? 2 : 1);
  render();
  logPatterns();
  await saveState(state);
}

async function handleRedo(): Promise<void> {
  if (busy || future.length === 0) {
    return;
  }
  stepHistory(future, past, future.length >= 2 ? 2 : 1);
  render();
  logPatterns();
  await saveState(state);
}

async function handleNewGame(): Promise<void> {
  if (busy) {
    return;
  }
  past = [];
  future = [];
  state = newGame();
  patternStore = PatternStore.fromBoard(state.board);
  render();
  await saveState(state);
}

async function init(): Promise<void> {
  logger.setDebug(true);
  buildBoard();

  try {
    state = await fetchState();
  } catch {
    state = newGame();
  }
  past = [];
  future = [];
  patternStore = PatternStore.fromBoard(state.board);
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
    handleNewGame().catch((error: unknown) => {
      logger.error(error);
    });
  });

  asciiToggleButton.addEventListener('click', () => {
    asciiPanelEl.hidden = !asciiPanelEl.hidden;
    asciiToggleButton.textContent = asciiPanelEl.hidden ? 'Show ASCII' : 'Hide ASCII';
  });
}

init().catch((error: unknown) => {
  logger.error(error);
});
