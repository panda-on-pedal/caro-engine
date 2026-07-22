<script lang="ts">
  import { tick } from 'svelte';
  import { session } from '../lib/gameSession.svelte.ts';

  let detailEl: HTMLParagraphElement | undefined = $state();

  const showDetail = $derived(
    Boolean(session.serverNotice) || session.settings.showThoughts,
  );

  $effect(() => {
    void session.thoughtLines;
    void session.serverNotice;
    void session.settings.showThoughts;
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
