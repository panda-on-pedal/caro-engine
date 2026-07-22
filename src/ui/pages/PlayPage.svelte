<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { isMultiAiMode } from '../urlState.ts';
  import TabStrip from '../components/TabStrip.svelte';
  import Board from '../components/Board.svelte';
  import Matchup from '../components/Matchup.svelte';
  import StatsPanel from '../components/StatsPanel.svelte';
  import Controls from '../components/Controls.svelte';
  import Status from '../components/Status.svelte';
  import AsciiPanel from '../components/AsciiPanel.svelte';
</script>

{#if isMultiAiMode(session.mode)}
  <TabStrip />
{/if}

<div class="play-row">
  {#if session.showingResults}
    <StatsPanel />
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

{#if session.asciiOpen && !session.showingResults}
  <AsciiPanel />
{/if}
