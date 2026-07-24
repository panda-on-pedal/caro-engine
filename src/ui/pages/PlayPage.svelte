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
