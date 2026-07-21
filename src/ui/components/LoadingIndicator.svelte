<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
</script>

<div id="loading" class="loading" role="status" aria-live="polite">
  <div class="loading-board" aria-hidden="true">
    {#each cells as i}
      <span
        class="loading-cell"
        class:mark-x={i === 0 || i === 4 || i === 8}
        class:mark-o={i === 2 || i === 6}
        style={`--i:${i}`}
      ></span>
    {/each}
  </div>
  <p id="status" class="loading-text">{session.localeTick >= 0 ? t('status.loading') : ''}</p>
</div>
