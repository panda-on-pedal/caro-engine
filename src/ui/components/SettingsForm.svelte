<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  function onToggleHighlight(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    session.setHighlightWhileThinking(checked);
  }

  function onToggleShowThoughts(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    session.setShowThoughts(checked);
  }

  function onToggleExperience(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    session.setExperienceImprovement(checked);
  }

  function onLang(event: Event): void {
    session.setLang((event.currentTarget as HTMLSelectElement).value);
  }
</script>

<label class="settings-row">
  <input
    id="pref-highlight-thinking"
    type="checkbox"
    checked={session.settings.highlightWhileThinking}
    onchange={onToggleHighlight}
  />
  <span>
    {session.localeTick >= 0 ? t('settings.highlightWhileThinking') : ''}
  </span>
</label>

<label class="settings-row">
  <input
    id="pref-show-thoughts"
    type="checkbox"
    checked={session.settings.showThoughts}
    onchange={onToggleShowThoughts}
  />
  <span>
    {session.localeTick >= 0 ? t('settings.showThoughts') : ''}
  </span>
</label>

<label class="settings-row">
  <input
    id="pref-experience-improvement"
    type="checkbox"
    checked={session.settings.experienceImprovement}
    onchange={onToggleExperience}
  />
  <span>
    {session.localeTick >= 0 ? t('settings.experienceImprovement') : ''}
  </span>
</label>

<label class="settings-row settings-row-select">
  <span>{session.localeTick >= 0 ? t('settings.language') : ''}</span>
  <select id="lang" aria-label={session.localeTick >= 0 ? t('settings.language') : ''} value={session.lang} onchange={onLang}>
    <option value="vi">{session.localeTick >= 0 ? t('lang.vi') : ''}</option>
    <option value="en">{session.localeTick >= 0 ? t('lang.en') : ''}</option>
  </select>
</label>
