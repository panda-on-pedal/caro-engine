<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { MAX_SETTLE_GIVE_UP_SEARCHES, MIN_SETTLE_GIVE_UP_SEARCHES } from '../prefs.ts';
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

  function onTogglePracticeImprovement(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    session.setPracticeImprovement(checked);
  }

  function onGiveUp(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (!Number.isNaN(value)) {
      session.setSettleGiveUpSearches(value);
    }
  }

  function onToggleNeverGiveUp(event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    session.setNeverGiveUp(checked);
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

<label class="settings-row">
  <input
    id="pref-practice-improvement"
    type="checkbox"
    checked={session.settings.practiceImprovement}
    onchange={onTogglePracticeImprovement}
  />
  <span>
    {session.localeTick >= 0 ? t('settings.practiceImprovement') : ''}
  </span>
</label>

<label class="settings-row">
  <input
    id="pref-never-give-up"
    type="checkbox"
    checked={session.settings.neverGiveUp}
    onchange={onToggleNeverGiveUp}
  />
  <span>
    {session.localeTick >= 0 ? t('settings.neverGiveUp') : ''}
  </span>
</label>

<label class="settings-row settings-row-select" class:settings-row-disabled={session.settings.neverGiveUp}>
  <span>{session.localeTick >= 0 ? t('settings.settleGiveUpSearches') : ''}</span>
  <input
    id="pref-settle-giveup"
    type="number"
    min={MIN_SETTLE_GIVE_UP_SEARCHES}
    max={MAX_SETTLE_GIVE_UP_SEARCHES}
    step="1"
    disabled={session.settings.neverGiveUp}
    value={session.settings.settleGiveUpSearches}
    onchange={onGiveUp}
  />
</label>

<label class="settings-row settings-row-select">
  <span>{session.localeTick >= 0 ? t('settings.language') : ''}</span>
  <select id="lang" aria-label={session.localeTick >= 0 ? t('settings.language') : ''} value={session.lang} onchange={onLang}>
    <option value="vi">{session.localeTick >= 0 ? t('lang.vi') : ''}</option>
    <option value="en">{session.localeTick >= 0 ? t('lang.en') : ''}</option>
  </select>
</label>

<style>
  .settings-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 0.95rem;
    color: var(--graphite);
    cursor: pointer;
  }

  .settings-row-select {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    cursor: default;
  }

  .settings-row-select select {
    min-width: 12rem;
  }

  .settings-row-disabled {
    opacity: 0.45;
  }

  .settings-row input {
    margin-top: 3px;
  }

  #lang {
    padding: 8px 10px;
    font-family: inherit;
    font-size: 0.95rem;
    color: var(--graphite);
    background: var(--cell-paper);
    border: 2px solid var(--graphite);
    border-radius: 3px;
  }
</style>
