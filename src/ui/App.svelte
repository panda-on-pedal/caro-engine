<script lang="ts">
  import { onMount } from 'svelte';
  import { parseHash, setHashRoute, type AppRoute } from './lib/hashRoute.ts';
  import { session } from './lib/gameSession.svelte.ts';
  import { t } from './i18n/index.ts';
  import NavRail from './components/NavRail.svelte';
  import LoadingIndicator from './components/LoadingIndicator.svelte';
  import VersionBadge from './components/VersionBadge.svelte';
  import PlayPage from './pages/PlayPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import InstructionsPage from './pages/InstructionsPage.svelte';

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

<div class="margin-col">
  <NavRail {route} />
</div>
<aside class="logo-col">
  <div class="titlebar">
    <a
      class="logo-link"
      href="#/"
      aria-label={session.localeTick >= 0 ? t('title') : ''}
      onclick={(event) => {
        event.preventDefault();
        setHashRoute('play');
      }}
    >
      <h1 id="title">{session.localeTick >= 0 ? t('title') : ''}</h1>
    </a>
    <p class="subtitle">{session.localeTick >= 0 ? t('subtitle') : ''}</p>
    <VersionBadge />
  </div>
</aside>
<main>
  {#if !session.ready}
    <LoadingIndicator />
  {:else if route === 'settings'}
    <SettingsPage />
  {:else if route === 'instructions'}
    <InstructionsPage />
  {:else}
    <PlayPage />
  {/if}
</main>
