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
