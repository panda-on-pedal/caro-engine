<!--
  SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
  SPDX-License-Identifier: AGPL-3.0-only
-->

<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';

  const sides = $derived(session.matchupSides);
</script>

<p id="matchup">
  <span id="matchup-p1" class="matchup-side" data-player="1">{sides.p1} (X)</span>
  <svg class="matchup-vs" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d="M3.1 3.4c2.4 2.1 5.1 4.6 9.6 9.2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
    <path
      d="M12.7 3.2c-2.3 2.4-5 5-9.4 9.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
  </svg>
  <span id="matchup-p2" class="matchup-side" data-player="2">{sides.p2} (O)</span>
</p>

<style>
  #matchup {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    align-self: stretch;
    margin: 0 0 0 var(--cell-size, 28px);
    font-family: "Consolas", "SFMono-Regular", Menlo, monospace;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    color: var(--muted);
  }

  .matchup-side[data-player="1"] {
    color: var(--ink-blue);
  }

  .matchup-side[data-player="2"] {
    color: var(--pen-red);
  }

  .matchup-vs {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    color: var(--graphite);
    opacity: 0.7;
  }
</style>
