<!--
  SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
  SPDX-License-Identifier: AGPL-3.0-only
-->

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

<style>
  .start-screen {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    max-width: 32rem;
    margin-top: var(--cell-size, 28px);
    margin-left: var(--cell-size, 28px);
  }

  .start-screen h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--graphite);
  }

  .start-desc {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--graphite);
  }

  .start-points {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.95rem;
    line-height: 1.4;
    color: var(--graphite);
  }

  #start-game {
    padding: 10px 20px;
    font-family: inherit;
    font-size: 1rem;
    margin-top: 4px;
    font-weight: 600;
    color: var(--paper);
    background: var(--ink-blue);
    border: 2px solid var(--ink-blue);
    border-radius: 3px 3px 0 0;
    box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.1);
    cursor: pointer;
  }
</style>
