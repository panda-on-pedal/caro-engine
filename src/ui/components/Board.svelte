<script lang="ts">
  import { BOARD_SIZE, session } from '../lib/gameSession.svelte.ts';
  import type { Move } from '../../engine/state.ts';
  import { logger } from '../../utils/logger.ts';

  const current = $derived(session.activeGameState);
  const isBusy = $derived(session.activeBusy);
  const human = $derived(session.humanPlayer);
  const lastMove = $derived(
    current.moveHistory[current.moveHistory.length - 1] as Move | undefined,
  );
  const winningCells = $derived(
    new Set((current.winningLine ?? []).map((move) => `${move.row},${move.col}`)),
  );

  function onCell(row: number, col: number): void {
    session.playCell(row, col).catch((error: unknown) => {
      logger.error(error);
    });
  }

  function cellDisabled(row: number, col: number): boolean {
    const value = current.board[row][col];
    return (
      isBusy || value !== 0 || current.nextPlayer !== human || current.winner !== null
    );
  }

  function isThinking(row: number, col: number): boolean {
    return (
      !!session.thinkingCell &&
      session.settings.highlightWhileThinking &&
      session.thinkingCell.row === row &&
      session.thinkingCell.col === col
    );
  }
</script>

<div id="board-grid">
  <div id="board-corner"></div>
  <div
    id="col-headers"
    style:grid-template-columns="repeat({BOARD_SIZE}, var(--cell-size))"
  >
    {#each { length: BOARD_SIZE } as _, i}
      <div class="header-cell">{i}</div>
    {/each}
  </div>
  <div
    id="row-headers"
    style:grid-template-rows="repeat({BOARD_SIZE}, var(--cell-size))"
  >
    {#each { length: BOARD_SIZE } as _, i}
      <div class="header-cell">{i}</div>
    {/each}
  </div>
  <div
    id="board"
    style:grid-template-columns="repeat({BOARD_SIZE}, var(--cell-size))"
    style:grid-template-rows="repeat({BOARD_SIZE}, var(--cell-size))"
  >
    {#each { length: BOARD_SIZE } as _, row}
      {#each { length: BOARD_SIZE } as _, col}
        {@const value = current.board[row][col]}
        <button
          type="button"
          class="cell"
          data-row={row}
          data-col={col}
          data-player={value === 0 ? undefined : String(value)}
          data-thinking={isThinking(row, col) ? 'true' : undefined}
          title={session.cellTitle(row, col)}
          disabled={cellDisabled(row, col)}
          style:transform={value === 0 ? '' : `rotate(${session.inkTilt(row, col)}deg)`}
          onclick={() => onCell(row, col)}
        >
          <span
            class="mark"
            data-last-move={lastMove && lastMove.row === row && lastMove.col === col
              ? 'true'
              : undefined}
            data-winning-cell={winningCells.has(`${row},${col}`) ? 'true' : undefined}
          >
            {value === 1 ? 'X' : value === 2 ? 'O' : ''}
          </span>
        </button>
      {/each}
    {/each}
  </div>
</div>
