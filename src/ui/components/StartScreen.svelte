<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { isTournamentMode } from '../urlState.ts';
  import { t } from '../i18n/index.ts';

  const isTournament = $derived(isTournamentMode(session.mode));
  const title = $derived(isTournament ? t('mode.aiAi') : t('mode.practice'));
</script>

<div id="start-screen" class="start-screen">
  <h2>{session.localeTick >= 0 ? title : ''}</h2>
  {#if isTournament}
    <p class="start-desc">{session.localeTick >= 0 ? t('start.tournament.desc') : ''}</p>
    <ul class="start-points">
      <li>{session.localeTick >= 0 ? t('start.tournament.selectBoards') : ''}</li>
      <li>{session.localeTick >= 0 ? t('start.tournament.tabs') : ''}</li>
      <li>{session.localeTick >= 0 ? t('start.tournament.results') : ''}</li>
    </ul>
  {:else}
    <p class="start-desc">{session.localeTick >= 0 ? t('start.practice.desc') : ''}</p>
    <ul class="start-points">
      <li>{session.localeTick >= 0 ? t('start.practice.selectBoards') : ''}</li>
      <li>{session.localeTick >= 0 ? t('start.practice.tabs') : ''}</li>
      <li>{session.localeTick >= 0 ? t('start.practice.restart') : ''}</li>
    </ul>
  {/if}
  <button id="start-game" type="button" class="start-button" onclick={() => session.start()}>
    {session.localeTick >= 0 ? t('controls.start') : ''}
  </button>
</div>
