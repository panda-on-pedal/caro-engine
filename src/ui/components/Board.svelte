<!--
  SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
  SPDX-License-Identifier: AGPL-3.0-only
-->

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

<style>
  #board-grid {
    display: grid;
    grid-template-columns: auto auto;
    grid-template-rows: auto auto;
  }

  #board-corner {
    width: var(--cell-size, 28px);
    height: var(--cell-size, 28px);
  }

  #col-headers,
  #row-headers {
    display: grid;
  }

  .header-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: "Consolas", "SFMono-Regular", Menlo, monospace;
    font-size: 9px;
    color: var(--muted);
  }

  #board {
    display: grid;
    gap: 0;
    background-color: var(--paper);
    background-image:
      linear-gradient(to right, var(--rule-blue) 1px, transparent 1px),
      linear-gradient(to bottom, var(--rule-blue) 1px, transparent 1px);
    background-size: var(--cell-size, 28px) var(--cell-size, 28px);
    border: 2px solid var(--graphite);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.08);
  }

  .cell {
    width: var(--cell-size, 28px);
    height: var(--cell-size, 28px);
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: inherit;
    font-family: "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive;
    font-size: 19px;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .cell:not(:disabled):hover {
    background: rgba(47, 93, 156, 0.14);
  }

  .cell:disabled {
    cursor: default;
  }

  .cell[data-player="1"] {
    color: var(--ink-blue);
  }

  .cell[data-player="2"] {
    color: var(--pen-red);
  }

  .mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 78%;
    height: 78%;
    border-radius: 50%;
    transition:
      box-shadow 0.15s ease,
      background-color 0.15s ease;
  }

  .mark[data-winning-cell="true"] {
    font-weight: 700;
    background-color: rgba(246, 214, 90, 0.65);
  }

  .mark[data-last-move="true"] {
    background-color: rgba(246, 214, 90, 0.9);
  }

  .cell[data-thinking="true"] {
    background-color: rgba(47, 93, 156, 0.12);
  }

  .cell[data-thinking="true"] .mark:not([data-last-move]):not([data-winning-cell]) {
    box-shadow: inset 0 0 0 2px rgba(47, 93, 156, 0.35);
  }

  .cell:focus {
    outline: none;
  }

  .cell:focus-visible {
    outline: 2px solid var(--ink-blue);
    outline-offset: -2px;
  }
</style>
