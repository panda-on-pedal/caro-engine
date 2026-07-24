<script lang="ts">
  import { session } from '../lib/gameSession.svelte.ts';
  import { t } from '../i18n/index.ts';

  function fmtScore(v: number | null): string {
    if (v === null) return '—';
    return v > 0 ? `+${v}` : `${v}`;
  }
  function fmtNodes(v: number | null): string {
    return v === null ? '—' : v.toLocaleString('en-US');
  }
  function fmtTime(at: number): string {
    return new Date(at).toLocaleTimeString('en-US', { hour12: false });
  }
  function shortKey(key: string): string {
    return key.length > 14 ? `${key.slice(0, 14)}…` : key;
  }
  function dots(stall: number, giveUp: number): string {
    const filled = Math.min(stall, giveUp);
    return '●'.repeat(filled) + '○'.repeat(Math.max(0, giveUp - filled));
  }
</script>

<div id="reports-panel">
  <p class="reports-summary">
    {session.localeTick >= 0
      ? t('reports.summary', {
          new: session.reportSummary.new,
          improved: session.reportSummary.improved,
          stalled: session.reportSummary.stalled,
          settled: session.reportSummary.settled,
          entries: session.reportSummary.bookEntries,
        })
      : ''}
  </p>

  {#if session.reportEvents.length === 0}
    <p class="reports-empty">{session.localeTick >= 0 ? t('reports.empty') : ''}</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>{t('reports.colTime')}</th>
          <th>{t('reports.colDiff')}</th>
          <th>{t('reports.colPos')}</th>
          <th>{t('reports.colScore')}</th>
          <th>{t('reports.colDepth')}</th>
          <th>{t('reports.colNodes')}</th>
          <th>{t('reports.colMove')}</th>
          <th>{t('reports.colLevel')}</th>
          <th>{t('reports.colStall')}</th>
        </tr>
      </thead>
      <tbody>
        {#each session.reportEvents as ev}
          <tr data-kind={ev.kind}>
            <td>{fmtTime(ev.at)}</td>
            <td>{ev.difficulty}</td>
            <td class="reports-key" title={ev.key}>{shortKey(ev.key)}</td>
            <td>{fmtScore(ev.oldScore)}→{fmtScore(ev.newScore)}</td>
            <td>d{ev.oldDepth ?? '—'}→d{ev.newDepth}</td>
            <td>{fmtNodes(ev.oldNodes)}→{fmtNodes(ev.newNodes)}</td>
            <td>{ev.moveChanged ? t('reports.moveChanged') : t('reports.moveSame')}</td>
            <td class="reports-level">L{ev.settleLevel}</td>
            <td class="reports-settle">
              {ev.stallCount >= ev.giveUp ? t('reports.permanent') : dots(ev.stallCount, ev.giveUp)}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <p class="stats-hint">{session.localeTick >= 0 ? t('reports.hintReset') : ''}</p>
</div>

<style>
  #reports-panel {
    min-width: 720px;
    max-width: 100%;
    overflow-x: auto;
  }

  #reports-panel .reports-summary {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
  }

  #reports-panel .reports-empty {
    margin: 0.5rem 0;
    font-size: 0.9rem;
    color: var(--graphite);
  }

  #reports-panel table {
    border-collapse: collapse;
    font-size: 0.8rem;
    background: var(--cell-paper);
  }

  #reports-panel th,
  #reports-panel td {
    padding: 4px 8px;
    border: 1px solid var(--rule-blue);
    text-align: right;
    white-space: nowrap;
  }

  #reports-panel th:first-child,
  #reports-panel td:first-child,
  #reports-panel .reports-key {
    text-align: left;
  }

  #reports-panel tr[data-kind="improved"] td.reports-level,
  #reports-panel tr[data-kind="new"] td.reports-level {
    color: var(--ink);
    font-weight: 600;
  }

  #reports-panel tr[data-kind="settled"] td.reports-settle {
    font-weight: 600;
  }

  #reports-panel .stats-hint {
    margin: 10px 0 0;
    max-width: 42rem;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--graphite);
    opacity: 0.85;
  }
</style>
