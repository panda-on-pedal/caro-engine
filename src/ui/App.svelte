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

<style>
  .margin-col {
    grid-column: 1;
    position: relative;
    min-height: 120px;
  }

  .logo-col {
    grid-column: 2;
    padding-top: 4px;
  }

  main {
    grid-column: 3;
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
  }

  .titlebar {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .logo-link {
    display: inline-block;
    text-decoration: none;
    border-radius: 8px;
    cursor: pointer;
    transform-origin: left center;
  }

  .logo-link:focus-visible {
    outline: 2px solid var(--ink-blue);
    outline-offset: 4px;
  }

  #title {
    position: relative;
    margin: 0;
    font-family: "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive;
    font-size: 3rem;
    font-weight: 400;
    color: var(--ink-blue);
    transform: rotate(-2deg);
    transition: transform 0.18s ease;
  }

  .logo-link:hover #title {
    transform: rotate(-3deg) scale(1.04);
  }

  .logo-link:hover #title::after {
    opacity: 1;
    transform: rotate(-2deg);
  }

  #title::after {
    content: "";
    position: absolute;
    left: 2px;
    right: 8px;
    bottom: -2px;
    height: 10px;
    border-bottom: 3px solid var(--pen-red);
    border-radius: 50%;
    opacity: 0.75;
    transform: rotate(-1deg);
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }

  .subtitle {
    margin: 0;
    font-family: "Consolas", "SFMono-Regular", Menlo, monospace;
    font-size: 0.7rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
