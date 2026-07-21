<script lang="ts">
  import { onMount } from 'svelte';
  import {
    APP_VERSION,
    GITHUB_RELEASES_URL,
    isNewerVersion,
    resolveLatestVersion,
  } from '../lib/appVersion.ts';
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  let updateAvailable = $state(false);
  let latestVersion = $state<string | null>(null);

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
  <p class="version-label" title={`caro-tournament@${APP_VERSION}`}>
    v{APP_VERSION}
  </p>
  {#if updateAvailable && latestVersion}
    <a class="version-update" href={GITHUB_RELEASES_URL} target="_blank" rel="noopener noreferrer">
      {session.localeTick >= 0 ? t('version.updateAvailable', { version: latestVersion }) : ''}
    </a>
  {/if}
</div>
