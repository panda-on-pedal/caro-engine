<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  function formatPct(value: number | null): string {
    return value === null ? '—' : `${value.toFixed(1)}%`;
  }
</script>

<div id="stats-panel">
  <section class="stats-section">
    <h3>{session.localeTick >= 0 ? t('stats.sectionPairings') : ''}</h3>
    <table>
      <thead>
        <tr>
          <th>{t('stats.pairing')}</th>
          <th>{t('stats.games')}</th>
          <th>{t('stats.p1Wins')}</th>
          <th>{t('stats.p2Wins')}</th>
          <th>{t('stats.draws')}</th>
          <th>{t('stats.p1WinPct')}</th>
          <th>{t('stats.avgMoves')}</th>
        </tr>
      </thead>
      <tbody>
        {#each session.pairingStats as row}
          <tr>
            <td>{row.p1}×{row.p2}</td>
            <td>{row.games}</td>
            <td>{row.p1Wins}</td>
            <td>{row.p2Wins}</td>
            <td>{row.draws}</td>
            <td>{row.games === 0 ? '—' : formatPct(row.p1WinPct)}</td>
            <td>
              {row.games === 0
                ? '—'
                : `${row.avgP1Moves.toFixed(1)} / ${row.avgP2Moves.toFixed(1)}`}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="stats-section">
    <h3>{session.localeTick >= 0 ? t('stats.sectionFirstPlayer') : ''}</h3>
    <p class="stats-summary">{session.firstPlayerWinPctLabel}</p>
  </section>

  <section class="stats-section">
    <h3>{session.localeTick >= 0 ? t('stats.sectionLeaderboard') : ''}</h3>
    <table>
      <thead>
        <tr>
          <th>{t('stats.player')}</th>
          <th>{t('stats.wins')}</th>
          <th>{t('stats.winPct')}</th>
        </tr>
      </thead>
      <tbody>
        {#each session.leaderboard as row}
          <tr>
            <td>{row.player}</td>
            <td>{row.wins}</td>
            <td>{row.games === 0 ? '—' : formatPct(row.winPct)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <p class="stats-hint">{session.localeTick >= 0 ? t('stats.hintCycle') : ''}</p>
  <p class="stats-hint">{session.localeTick >= 0 ? t('stats.hintReset') : ''}</p>
</div>

<style>
  #stats-panel {
    min-width: 560px;
  }

  #stats-panel:global([hidden]) {
    display: none;
  }

  #stats-panel .stats-section {
    margin-bottom: 1.1rem;
  }

  #stats-panel .stats-section h3 {
    margin: 0 0 0.45rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--ink);
  }

  #stats-panel .stats-summary {
    margin: 0;
    font-size: 0.9rem;
  }

  #stats-panel table {
    border-collapse: collapse;
    font-size: 0.85rem;
    background: var(--cell-paper);
  }

  #stats-panel th,
  #stats-panel td {
    padding: 4px 10px;
    border: 1px solid var(--rule-blue);
    text-align: right;
  }

  #stats-panel th:first-child,
  #stats-panel td:first-child {
    text-align: left;
  }

  #stats-panel .stats-hint {
    margin: 10px 0 0;
    max-width: 42rem;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--graphite);
    opacity: 0.85;
  }
</style>
