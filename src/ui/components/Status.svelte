<script lang="ts">
  import { tick } from 'svelte';
  import { session } from '../lib/gameSession.svelte.ts';

  let detailEl: HTMLParagraphElement | undefined = $state();

  $effect(() => {
    void session.thoughtLines;
    void session.serverNotice;
    tick().then(() => {
      if (detailEl) {
        detailEl.scrollTop = detailEl.scrollHeight;
      }
    });
  });
</script>

<p id="status" data-done={session.statusDone ? 'true' : undefined}>
  {session.statusMessage}
</p>
{#if session.statusDetailText}
  <p
    id="status-detail"
    bind:this={detailEl}
    data-severity={session.statusDetailSeverity ?? undefined}
  >
    {session.statusDetailText}
  </p>
{/if}
