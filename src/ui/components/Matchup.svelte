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
