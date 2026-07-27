<script lang="ts">
  import { onMount } from 'svelte';
  import {
    APP_VERSION,
    isNewerVersion,
    releaseTagUrl,
    resolveLatestVersion,
  } from '../lib/appVersion.ts';
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  let updateAvailable = $state(false);
  let latestVersion = $state<string | null>(null);

  const currentReleaseUrl = releaseTagUrl(APP_VERSION);
  let upToDate = $derived(
    latestVersion !== null && !updateAvailable && !isNewerVersion(APP_VERSION, latestVersion),
  );

  onMount(() => {
    let cancelled = false;
    resolveLatestVersion()
      .then((result) => {
        if (cancelled || !result.latestVersion) {
          return;
        }
        latestVersion = result.latestVersion;
        updateAvailable = isNewerVersion(result.latestVersion, APP_VERSION);
      })
      .catch(() => {
        /* ignore network errors */
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="version-block">
  <a
    class="version-label"
    href={currentReleaseUrl}
    target="_blank"
    rel="noopener noreferrer"
    title={`caro-tournament@${APP_VERSION}`}
  >
    v{APP_VERSION}
  </a>
  {#if updateAvailable && latestVersion}
    <a
      class="version-update"
      href={releaseTagUrl(latestVersion)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {session.localeTick >= 0 ? t('version.updateAvailable', { version: latestVersion }) : ''}
    </a>
  {:else if upToDate}
    <a
      class="version-uptodate"
      href={currentReleaseUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {session.localeTick >= 0 ? t('version.upToDate', { version: APP_VERSION }) : ''}
    </a>
  {/if}
</div>

<style>
  .version-block {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    margin-top: 10px;
  }

  .version-label {
    margin: 0;
    font-family: "Consolas", "SFMono-Regular", Menlo, monospace;
    font-size: 0.75rem;
    color: var(--muted);
    text-decoration: none;
  }

  .version-label:hover {
    color: var(--ink-blue);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .version-update,
  .version-uptodate {
    font-family: "Consolas", "SFMono-Regular", Menlo, monospace;
    font-size: 0.72rem;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .version-update {
    color: var(--pen-red);
  }

  .version-update:hover {
    color: #9e2f2c;
  }

  .version-uptodate {
    color: var(--muted);
  }

  .version-uptodate:hover {
    color: var(--ink-blue);
  }

  .version-label:focus-visible,
  .version-update:focus-visible,
  .version-uptodate:focus-visible {
    outline: 2px solid var(--ink-blue);
    outline-offset: 2px;
  }
</style>
