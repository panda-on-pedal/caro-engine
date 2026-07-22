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
