<script lang="ts">
  import { setHashRoute, type AppRoute } from '../lib/hashRoute.ts';
  import { GITHUB_REPO_URL } from '../lib/appVersion.ts';
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  let { route }: { route: AppRoute } = $props();
</script>

<nav class="nav-rail" aria-label={session.localeTick >= 0 ? t('nav.label') : ''}>
  <a
    class="nav-rail-link"
    class:active={route === 'instructions'}
    href="#/instructions"
    aria-label={session.localeTick >= 0 ? t('nav.instructions') : ''}
    aria-current={route === 'instructions' ? 'page' : undefined}
    onclick={(event) => {
      event.preventDefault();
      setHashRoute('instructions');
    }}
  >
    <span class="nav-rail-marker" aria-hidden="true"></span>
    <svg class="nav-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  </a>
  <a
    class="nav-rail-link"
    class:active={route === 'settings'}
    href="#/settings"
    aria-label={session.localeTick >= 0 ? t('nav.settings') : ''}
    aria-current={route === 'settings' ? 'page' : undefined}
    onclick={(event) => {
      event.preventDefault();
      setHashRoute('settings');
    }}
  >
    <span class="nav-rail-marker" aria-hidden="true"></span>
    <svg class="nav-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
      />
    </svg>
  </a>
  <a
    class="nav-rail-link"
    href={GITHUB_REPO_URL}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={session.localeTick >= 0 ? t('nav.github') : ''}
  >
    <span class="nav-rail-marker" aria-hidden="true"></span>
    <svg class="nav-rail-icon nav-rail-icon-fill" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2C6.477 2 2 6.586 2 12.253c0 4.537 2.865 8.374 6.839 9.727.5.094.682-.222.682-.482 0-.237-.009-.866-.013-1.7-2.782.62-3.369-1.38-3.369-1.38-.454-1.184-1.11-1.5-1.11-1.5-.908-.638.069-.625.069-.625 1.004.072 1.532 1.06 1.532 1.06.892 1.57 2.341 1.116 2.91.854.091-.665.35-1.116.636-1.372-2.22-.26-4.555-1.142-4.555-5.086 0-1.124.39-2.041 1.029-2.76-.103-.26-.446-1.302.098-2.714 0 0 .84-.276 2.75 1.055A9.3 9.3 0 0 1 12 6.84a9.3 9.3 0 0 1 2.504.347c1.909-1.331 2.747-1.055 2.747-1.055.546 1.412.203 2.454.1 2.714.64.719 1.028 1.636 1.028 2.76 0 3.954-2.338 4.823-4.566 5.078.359.318.679.946.679 1.908 0 1.377-.012 2.486-.012 2.824 0 .263.18.58.688.481A10.01 10.01 0 0 0 22 12.253C22 6.586 17.523 2 12 2z"
      />
    </svg>
  </a>
</nav>

<style>
  .nav-rail {
    /* Keep icons in the red-margin gutter (line sits at 55px), not the full 72px column. */
    position: sticky;
    top: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 20px 0 0;
    width: 55px;
    box-sizing: border-box;
  }

  .nav-rail-link {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    color: var(--ink-blue);
    text-decoration: none;
  }

  .nav-rail-link:hover {
    color: #1f4478;
  }

  .nav-rail-link:focus-visible {
    outline: 2px solid var(--ink-blue);
    outline-offset: 3px;
    border-radius: 4px;
  }

  .nav-rail-icon {
    display: block;
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .nav-rail-marker {
    position: absolute;
    left: -2px;
    top: 50%;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--pen-red);
    transform: translateY(-50%);
    opacity: 0;
    pointer-events: none;
  }

  .nav-rail-link.active .nav-rail-marker {
    opacity: 1;
  }

  .nav-rail-icon-fill {
    fill: currentColor;
    stroke: none;
  }
</style>
