<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  function onToggle(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    session.setHighlightWhileThinking(checked);
  }
</script>

<label class="settings-row">
  <input
    id="pref-highlight-thinking"
    type="checkbox"
    checked={session.settings.highlightWhileThinking}
    onchange={onToggle}
  />
  <span>
    {session.localeTick >= 0 ? t('settings.highlightWhileThinking') : ''}
  </span>
</label>
