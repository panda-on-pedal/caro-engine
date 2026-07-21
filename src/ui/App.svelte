<script lang="ts">
  import { onMount } from 'svelte';
  import { parseHash, type AppRoute } from './lib/hashRoute.ts';
  import { session } from './lib/gameSession.svelte.ts';
  import { t } from './i18n/index.ts';
  import PlayPage from './pages/PlayPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';

  let route = $state<AppRoute>(parseHash(typeof window !== 'undefined' ? window.location.hash : ''));

  onMount(() => {
    const onHash = (): void => {
      route = parseHash(window.location.hash);
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  });
</script>

<div class="margin-col"></div>
<aside class="logo-col">
  <div class="titlebar">
    <h1 id="title">{session.localeTick >= 0 ? t('title') : ''}</h1>
    <p class="subtitle">{session.localeTick >= 0 ? t('subtitle') : ''}</p>
  </div>
</aside>
<main>
  {#if !session.ready}
    <p id="status">{t('status.loading')}</p>
  {:else if route === 'settings'}
    <SettingsPage />
  {:else}
    <PlayPage />
  {/if}
</main>
