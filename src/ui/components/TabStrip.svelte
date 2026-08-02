<!--
  SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
  SPDX-License-Identifier: AGPL-3.0-only
-->

<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { isTournamentMode } from '../urlState.ts';
  import { t } from '../i18n/index.ts';
</script>

<div id="tab-strip">
  {#each session.sessions as boardSession, index (boardSession.id)}
    <button
      type="button"
      class="tab-button"
      data-board-index={index}
      data-status={session.sessionTabStatus(boardSession)}
      data-active={!session.viewingResults && !session.viewingReports && index === session.activeIndex ? 'true' : undefined}
      onclick={() => session.selectBoard(index)}
    >
      {session.tabLabel(index, boardSession)}
    </button>
  {/each}
  {#if isTournamentMode(session.mode)}
    <button
      type="button"
      class="tab-button tab-button-results"
      data-results="true"
      data-active={session.viewingResults ? 'true' : undefined}
      onclick={() => session.selectResults()}
    >
      {session.localeTick >= 0 ? t('tabs.results') : ''}
    </button>
  {:else if session.mode === 'practice'}
    <button
      type="button"
      class="tab-button tab-button-results"
      data-reports="true"
      data-active={session.viewingReports ? 'true' : undefined}
      onclick={() => session.selectReports()}
    >
      {session.localeTick >= 0 ? t('tabs.reports') : ''}
    </button>
  {/if}
</div>

<style>
  #tab-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: var(--cell-size, 28px);
    margin-left: var(--cell-size, 28px);
  }

  #tab-strip:global([hidden]) {
    display: none;
  }

  .tab-button {
    padding: 4px 10px;
    font-family: inherit;
    font-size: 0.8rem;
    color: var(--graphite);
    background: var(--cell-paper);
    border: 2px solid var(--graphite);
    border-radius: 3px 3px 0 0;
    cursor: pointer;
  }

  .tab-button:hover {
    background: #f1ead8;
  }

  .tab-button[data-active="true"] {
    background-image: linear-gradient(180deg, transparent 55%, var(--highlighter) 55%);
    font-weight: 600;
  }

  .tab-button[data-status="thinking"]::after {
    content: " •";
    color: var(--ink-blue);
  }

  .tab-button[data-status="restarting"]::after {
    content: " •";
    color: var(--pen-red);
  }

  .tab-button-results {
    margin-left: 8px;
    padding-left: 14px;
    border-left: 2px dashed var(--muted);
  }
</style>
