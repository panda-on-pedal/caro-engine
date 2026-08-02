<!--
  SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
  SPDX-License-Identifier: AGPL-3.0-only
-->

<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { isMultiAiMode } from '../urlState.ts';
  import TabStrip from '../components/TabStrip.svelte';
  import Board from '../components/Board.svelte';
  import Matchup from '../components/Matchup.svelte';
  import StatsPanel from '../components/StatsPanel.svelte';
  import ReportsPanel from '../components/ReportsPanel.svelte';
  import Controls from '../components/Controls.svelte';
  import Status from '../components/Status.svelte';
  import AsciiPanel from '../components/AsciiPanel.svelte';
  import StartScreen from '../components/StartScreen.svelte';

  const idleMultiAi = $derived(isMultiAiMode(session.mode) && !session.started);
</script>

{#if isMultiAiMode(session.mode) && session.started}
  <TabStrip />
{/if}

<div class="play-row">
  {#if session.showingResults}
    <StatsPanel />
  {:else if session.showingReports}
    <ReportsPanel />
  {:else if idleMultiAi}
    <div class="play-layout">
      <StartScreen />
      <div id="controls" class="controls">
        <Controls />
      </div>
    </div>
  {:else}
    <div class="play-layout">
      <Board />
      <div id="controls" class="controls">
        <Controls />
        <Status />
      </div>
      <Matchup />
    </div>
  {/if}
</div>

{#if session.asciiOpen && !session.showingResults && !session.showingReports && !idleMultiAi}
  <AsciiPanel />
{/if}

<style>
  .play-row {
    display: flex;
    gap: 18px;
    align-items: flex-start;
  }

  .play-layout {
    display: grid;
    grid-template-columns: max-content 170px;
    grid-template-rows: auto auto;
    column-gap: 18px;
    row-gap: 8px;
    align-items: stretch;
  }

  .play-layout > :global(#board-grid) {
    grid-column: 1;
    grid-row: 1;
  }

  .play-layout > .controls {
    grid-column: 2;
    grid-row: 1;
  }

  .play-layout > :global(#matchup) {
    grid-column: 1;
    grid-row: 2;
  }

  .controls {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    width: 170px;
    /* Fill board row height without letting thought content expand the row. */
    box-sizing: border-box;
    height: 0;
    min-height: 100%;
    padding-top: var(--cell-size, 28px);
    overflow: hidden;
    min-width: 0;
  }

  .controls:global([hidden]) {
    display: none;
  }
</style>
