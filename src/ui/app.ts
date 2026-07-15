import { BOARD_SIZE } from '../engine/board.ts';
import { chooseMove } from '../engine/engine.ts';
import { applyMove, deserializeState, newGame, serializeState, type GameState } from '../engine/state.ts';

const STATE_URL = '/api/state';
const AI_THINK_DELAY_MS = 300;
const CELL_SIZE_PX = 28;

const statusEl = document.getElementById('status') as HTMLParagraphElement;
const boardEl = document.getElementById('board') as HTMLDivElement;
const newGameButton = document.getElementById('new-game') as HTMLButtonElement;

let state: GameState = newGame();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      cell.disabled = value !== 0 || state.nextPlayer !== 1 || state.winner !== null;
    }
  }
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
      fragment.appendChild(cell);
    }
  }
  boardEl.appendChild(fragment);
}

async function handleCellClick(event: MouseEvent): Promise<void> {
  if (state.nextPlayer !== 1 || state.winner !== null) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || target.disabled || !target.dataset.row || !target.dataset.col) {
    return;
  }

  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);

  state = applyMove(state, { row, col }, 1);
  render();

  if (state.winner === null) {
    await delay(AI_THINK_DELAY_MS);
    state = applyMove(state, chooseMove(state), 2);
  }
  render();

  await saveState(state);
}

async function handleNewGame(): Promise<void> {
  state = newGame();
  render();
  await saveState(state);
}

async function init(): Promise<void> {
  buildBoard();

  try {
    state = await fetchState();
  } catch {
    state = newGame();
  }
  render();

  boardEl.addEventListener('click', (event) => {
    handleCellClick(event).catch((error: unknown) => {
      console.error(error);
    });
  });

  newGameButton.addEventListener('click', () => {
    handleNewGame().catch((error: unknown) => {
      console.error(error);
    });
  });
}

init().catch((error: unknown) => {
  console.error(error);
});
