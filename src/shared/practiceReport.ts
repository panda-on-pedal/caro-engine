// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { Difficulty } from "../engine/engine.ts";

export type PracticeReportKind = "new" | "improved" | "stalled" | "settled";

export interface PracticeReportEvent {
  kind: PracticeReportKind;
  difficulty: Difficulty;
  key: string;
  /** Stored entry before this search (null for a brand-new position). */
  oldScore: number | null;
  /** This search's result. */
  newScore: number;
  oldDepth: number | null;
  newDepth: number;
  /** Nodes the search visited — stored (before) → this search (after). */
  oldNodes: number | null;
  newNodes: number;
  moveChanged: boolean;
  /** Improvement counter after this transition. */
  settleLevel: number;
  /** Consecutive non-improving searches after this transition (0..giveUp). */
  stallCount: number;
  /** Give-up threshold in effect for this event. */
  giveUp: number;
  /** Board this event came from (practice foreground search). Absent for
   *  background-improvement reports → aggregate-only, no per-board feed. */
  boardId?: number;
  at: number;
}

export interface PracticeReportCounts {
  new: number;
  improved: number;
  stalled: number;
  settled: number;
}

export interface PracticeReportSummary extends PracticeReportCounts {
  bookEntries: number;
}

export const EMPTY_REPORT_COUNTS: PracticeReportCounts = {
  new: 0,
  improved: 0,
  stalled: 0,
  settled: 0,
};
/** Newest-first event buffer size for the Reports tab (rolling). */
export const REPORT_BUFFER_CAP = 100;

/** Fold one event into running session totals (pure — returns a new object). */
export function tallyReportEvent(
  counts: PracticeReportCounts,
  ev: PracticeReportEvent
): PracticeReportCounts {
  return { ...counts, [ev.kind]: counts[ev.kind] + 1 };
}

export function summarizeReport(
  counts: PracticeReportCounts,
  bookEntries: number
): PracticeReportSummary {
  return { ...counts, bookEntries };
}

/** Prepend `item`, keeping the buffer newest-first and capped. */
export function pushCapped<T>(buffer: T[], item: T, cap = REPORT_BUFFER_CAP): T[] {
  const next = [item, ...buffer];
  return next.length > cap ? next.slice(0, cap) : next;
}
