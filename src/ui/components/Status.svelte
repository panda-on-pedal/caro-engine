<script lang="ts">
  import { tick } from 'svelte';
  import { session } from '../lib/gameSession.svelte.ts';

  let detailEl: HTMLParagraphElement | undefined = $state();

  /** Live human-vs-AI thoughts OR practice per-board learning feed OR notices. */
  const showDetail = $derived(
    Boolean(session.serverNotice) ||
      session.settings.showThoughts ||
      (session.mode === 'practice' && session.activeBoardReportLines.length > 0),
  );

  $effect(() => {
    void session.thoughtLines;
    void session.boardReportLines;
    void session.activeIndex;
    void session.serverNotice;
    void session.settings.showThoughts;
    void session.mode;
    tick().then(() => {
      if (detailEl) {
        detailEl.scrollTop = detailEl.scrollHeight;
      }
    });
  });
</script>

<div class="status-panel">
  <p id="status" data-done={session.statusDone ? 'true' : undefined}>
    {session.statusMessage}
  </p>
  {#if showDetail}
    <p
      id="status-detail"
      bind:this={detailEl}
      data-severity={session.statusDetailSeverity ?? undefined}
    >
      {session.statusDetailText}
    </p>
  {/if}
</div>

<style>
  .status-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 4px;
  }

  #status {
    flex: 0 0 auto;
    font-size: 1.05rem;
    min-height: 1.4em;
    margin: 0;
  }

  #status[data-done] {
    font-weight: 600;
    padding: 0 4px;
    background-image: linear-gradient(180deg, transparent 60%, var(--highlighter) 60%);
  }

  #status-detail {
    flex: 1;
    min-height: 0;
    margin: 0;
    overflow-y: auto;
    font-size: 0.85rem;
    line-height: 1.35;
    color: var(--muted);
    white-space: pre-line;
  }

  #status-detail[data-severity="error"] {
    color: var(--pen-red);
  }

  #status-detail:global([hidden]) {
    display: none;
  }
</style>
