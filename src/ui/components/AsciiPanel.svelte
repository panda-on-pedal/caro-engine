<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
</script>

<div id="ascii-panel">
  <textarea id="ascii-text" readonly spellcheck="false" value={session.asciiText}></textarea>
</div>
