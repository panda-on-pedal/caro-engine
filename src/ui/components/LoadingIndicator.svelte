<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
</script>

<div id="loading" class="loading" role="status" aria-live="polite">
  <div class="loading-board" aria-hidden="true">
    {#each cells as i}
      <span
        class="loading-cell"
        class:mark-x={i === 0 || i === 4 || i === 8}
        class:mark-o={i === 2 || i === 6}
        style={`--i:${i}`}
      ></span>
    {/each}
  </div>
  <p id="status" class="loading-text">{session.localeTick >= 0 ? t('status.loading') : ''}</p>
</div>

<style>
  .loading {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    margin-top: var(--cell-size, 28px);
    margin-left: var(--cell-size, 28px);
  }

  .loading-board {
    display: grid;
    grid-template-columns: repeat(3, 22px);
    grid-template-rows: repeat(3, 22px);
    gap: 0;
    border: 1px solid var(--rule-blue);
    background: var(--cell-paper);
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.06);
  }

  .loading-cell {
    position: relative;
    border-right: 1px solid var(--rule-blue);
    border-bottom: 1px solid var(--rule-blue);
    opacity: 0.25;
    animation: loading-pulse 1.2s ease-in-out infinite;
    animation-delay: calc(var(--i) * 0.08s);
  }

  .loading-cell:nth-child(3n) {
    border-right: none;
  }

  .loading-cell:nth-child(n + 7) {
    border-bottom: none;
  }

  .loading-cell.mark-x::before,
  .loading-cell.mark-x::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 12px;
    height: 2px;
    background: var(--ink-blue);
    border-radius: 1px;
  }

  .loading-cell.mark-x::before {
    transform: translate(-50%, -50%) rotate(45deg);
  }

  .loading-cell.mark-x::after {
    transform: translate(-50%, -50%) rotate(-45deg);
  }

  .loading-cell.mark-o::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 10px;
    height: 10px;
    border: 2px solid var(--pen-red);
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }

  .loading-text {
    margin: 0;
    font-size: 1.05rem;
    min-height: 1.4em;
    color: var(--graphite);
  }

  @keyframes loading-pulse {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-cell {
      animation: none;
      opacity: 1;
    }
  }
</style>
