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
      data-active={!session.viewingResults && index === session.activeIndex ? 'true' : undefined}
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
  {/if}
</div>
