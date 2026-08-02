<!--
  SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
  SPDX-License-Identifier: AGPL-3.0-only
-->

<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import type { Difficulty, GameMode } from '../lib/gameSession.svelte.ts';
  import { isMultiAiMode } from '../urlState.ts';
  import { t } from '../i18n/index.ts';
  import { logger } from '../../utils/logger.ts';

  const isMultiAi = $derived(isMultiAiMode(session.mode));

  function onMode(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value as GameMode;
    session.setMode(value);
  }

  function onDifficulty(event: Event): void {
    session.setDifficulty((event.currentTarget as HTMLSelectElement).value as Difficulty);
  }

  function onBoardCount(event: Event): void {
    session.setBoardCount(Number((event.currentTarget as HTMLSelectElement).value));
  }

  function onNewGame(): void {
    session.newGame().catch((error: unknown) => {
      logger.error(error);
    });
  }

  function onUndo(): void {
    session.undo().catch((error: unknown) => {
      logger.error(error);
    });
  }

  function onRedo(): void {
    session.redo().catch((error: unknown) => {
      logger.error(error);
    });
  }
</script>

<select id="game-mode" value={session.mode} onchange={onMode}>
  <option value="human-ai">{session.localeTick >= 0 ? t('mode.humanAi') : ''}</option>
  <option value="ai-human">{session.localeTick >= 0 ? t('mode.aiHuman') : ''}</option>
  <option value="ai-ai">{session.localeTick >= 0 ? t('mode.aiAi') : ''}</option>
  <option value="practice">{session.localeTick >= 0 ? t('mode.practice') : ''}</option>
</select>

{#if !isMultiAi}
  <select id="difficulty" value={session.difficulty} onchange={onDifficulty}>
    <option value="easy">{session.localeTick >= 0 ? t('difficulty.easy') : ''}</option>
    <option value="medium">{session.localeTick >= 0 ? t('difficulty.medium') : ''}</option>
    <option value="hard">{session.localeTick >= 0 ? t('difficulty.hard') : ''}</option>
    <option value="expert">{session.localeTick >= 0 ? t('difficulty.expert') : ''}</option>
  </select>
{:else}
  <select id="board-count" value={String(session.boardCount)} onchange={onBoardCount}>
    {#each session.boardOptions() as n}
      <option value={String(n)}>{session.boardOptionLabel(n)}</option>
    {/each}
  </select>
  {#if session.started}
    <button id="pause" type="button" onclick={() => session.togglePause()}>
      {session.localeTick >= 0
        ? session.autoplayPaused
          ? t('controls.resume')
          : t('controls.pause')
        : ''}
    </button>
  {/if}
{/if}

{#if !isMultiAi}
  <button id="undo" type="button" disabled={!session.canUndo} onclick={onUndo}>
    {session.localeTick >= 0 ? t('controls.undo') : ''}
  </button>
  <button id="redo" type="button" disabled={!session.canRedo} onclick={onRedo}>
    {session.localeTick >= 0 ? t('controls.redo') : ''}
  </button>
{/if}

{#if !isMultiAi || session.started}
  <button id="new-game" type="button" onclick={onNewGame}>
    {session.localeTick >= 0 ? t('controls.newGame') : ''}
  </button>

  <button id="ascii-toggle" type="button" onclick={() => session.toggleAscii()}>
    {session.localeTick >= 0
      ? session.asciiOpen
        ? t('controls.hideAscii')
        : t('controls.showAscii')
      : ''}
  </button>
{/if}

<style>
  #game-mode,
  #difficulty,
  #board-count {
    padding: 8px 10px;
    font-family: inherit;
    font-size: 0.95rem;
    color: var(--graphite);
    background: var(--cell-paper);
    border: 2px solid var(--graphite);
    border-radius: 3px;
  }

  #new-game,
  #undo,
  #redo,
  #pause,
  #ascii-toggle {
    padding: 10px 20px;
    font-family: inherit;
    font-size: 1rem;
    color: var(--graphite);
    background: var(--cell-paper);
    border: 2px solid var(--graphite);
    border-radius: 3px 3px 0 0;
    box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.1);
    cursor: pointer;
  }

  #new-game:hover,
  #undo:hover:not(:disabled),
  #redo:hover:not(:disabled),
  #pause:hover:not(:disabled),
  #ascii-toggle:hover {
    background: #f1ead8;
  }

  #new-game:active,
  #undo:active:not(:disabled),
  #redo:active:not(:disabled),
  #pause:active:not(:disabled),
  #ascii-toggle:active {
    box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.1);
    transform: translate(2px, 2px);
  }

  #new-game:focus-visible,
  #undo:focus-visible,
  #redo:focus-visible,
  #pause:focus-visible,
  #ascii-toggle:focus-visible {
    outline: 2px solid var(--ink-blue);
    outline-offset: 2px;
  }

  #undo:disabled,
  #redo:disabled,
  #pause:disabled {
    opacity: 0.45;
    cursor: default;
    box-shadow: none;
  }
</style>
