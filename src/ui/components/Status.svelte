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
