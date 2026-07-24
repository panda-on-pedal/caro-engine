<script lang="ts">
  import { setHashRoute } from '../lib/hashRoute.ts';
  import SettingsForm from '../components/SettingsForm.svelte';
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  function back(): void {
    setHashRoute('play');
  }
</script>

<div id="settings-panel">
  <h2>{session.localeTick >= 0 ? t('settings.title') : ''}</h2>
  <SettingsForm />
  <button id="settings-back" type="button" onclick={back}>
    {session.localeTick >= 0 ? t('settings.back') : ''}
  </button>
</div>

<style>
  #settings-panel {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    min-width: min(420px, 100%);
    max-width: 36rem;
    margin-top: var(--cell-size, 28px);
    margin-left: var(--cell-size, 28px);
  }

  #settings-panel:global([hidden]) {
    display: none;
  }

  #settings-panel h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--graphite);
  }

  #settings-back {
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

  #settings-back:hover {
    background: #f1ead8;
  }

  #settings-back:active {
    box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.1);
    transform: translate(2px, 2px);
  }

  #settings-back:focus-visible {
    outline: 2px solid var(--ink-blue);
    outline-offset: 2px;
  }
</style>
