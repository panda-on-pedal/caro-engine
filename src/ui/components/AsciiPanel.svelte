<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
</script>

<div id="ascii-panel">
  <textarea id="ascii-text" readonly spellcheck="false" value={session.asciiText}></textarea>
</div>

<style>
  #ascii-panel {
    width: 100%;
    max-width: 480px;
    margin-left: var(--cell-size, 28px);
  }

  #ascii-text {
    width: 100%;
    height: 260px;
    padding: 10px;
    font-family: "Consolas", "SFMono-Regular", Menlo, monospace;
    font-size: 12px;
    line-height: 1.35;
    white-space: pre;
    color: var(--graphite);
    background: var(--cell-paper);
    border: 2px solid var(--graphite);
    border-radius: 3px;
    resize: vertical;
  }
</style>
