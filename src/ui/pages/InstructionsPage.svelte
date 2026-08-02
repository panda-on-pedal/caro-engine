<!--
  SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
  SPDX-License-Identifier: AGPL-3.0-only
-->

<script lang="ts">
  import { setHashRoute } from '../lib/hashRoute.ts';
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  function back(): void {
    setHashRoute('play');
  }
</script>

<div id="instructions-panel" class="info-panel">
  <h2>{session.localeTick >= 0 ? t('instructions.title') : ''}</h2>

  <section class="info-section">
    <h3>{session.localeTick >= 0 ? t('instructions.rulesTitle') : ''}</h3>
    <ul>
      <li>{session.localeTick >= 0 ? t('instructions.rules.place') : ''}</li>
      <li>{session.localeTick >= 0 ? t('instructions.rules.win') : ''}</li>
      <li>{session.localeTick >= 0 ? t('instructions.rules.block') : ''}</li>
    </ul>
  </section>

  <section class="info-section">
    <h3>{session.localeTick >= 0 ? t('instructions.modesTitle') : ''}</h3>
    <ul>
      <li>
        <strong>{session.localeTick >= 0 ? t('mode.humanAi') : ''}</strong>: {session.localeTick >= 0 ? t('instructions.modes.humanAi') : ''}
      </li>
      <li>
        <strong>{session.localeTick >= 0 ? t('mode.aiHuman') : ''}</strong>: {session.localeTick >= 0 ? t('instructions.modes.aiHuman') : ''}
      </li>
      <li>
        <strong>{session.localeTick >= 0 ? t('mode.aiAi') : ''}</strong>: {session.localeTick >= 0 ? t('instructions.modes.aiAi') : ''}
      </li>
      <li>
        <strong>{session.localeTick >= 0 ? t('mode.practice') : ''}</strong>: {session.localeTick >= 0 ? t('instructions.modes.practice') : ''}
      </li>
    </ul>
  </section>

  <section class="info-section">
    <h3>{session.localeTick >= 0 ? t('instructions.tipsTitle') : ''}</h3>
    <ul>
      <li>{session.localeTick >= 0 ? t('instructions.tips.paths') : ''}</li>
      <li>{session.localeTick >= 0 ? t('instructions.tips.block') : ''}</li>
    </ul>
  </section>

  <button id="instructions-back" type="button" onclick={back}>
    {session.localeTick >= 0 ? t('settings.back') : ''}
  </button>
</div>

<style>
  #instructions-panel {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    min-width: min(420px, 100%);
    max-width: 36rem;
    margin-top: var(--cell-size, 28px);
    margin-left: var(--cell-size, 28px);
  }

  #instructions-panel h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--graphite);
  }

  .info-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  .info-section h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--ink-blue);
  }

  #instructions-panel .info-section h3 {
    position: relative;
    display: inline-block;
    align-self: flex-start;
    padding-bottom: 5px;
  }

  #instructions-panel .info-section h3::after {
    content: "";
    position: absolute;
    left: 1px;
    right: 3px;
    bottom: 0;
    height: 7px;
    border-bottom: 2px solid var(--pen-red);
    border-radius: 50%;
    opacity: 0.7;
    transform: rotate(-1deg);
  }

  .info-section ul {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.95rem;
    line-height: 1.4;
    color: var(--graphite);
  }

  #instructions-back {
    padding: 10px 20px;
    font-family: inherit;
    font-size: 1rem;
    color: var(--graphite);
    background: var(--cell-paper);
    border: 2px solid var(--graphite);
    border-radius: 3px 3px 0 0;
    box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.1);
    cursor: pointer;
  }

  #instructions-back:hover {
    background: #f1ead8;
  }

  #instructions-back:active {
    box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.1);
    transform: translate(2px, 2px);
  }

  #instructions-back:focus-visible {
    outline: 2px solid var(--ink-blue);
    outline-offset: 2px;
  }
</style>
