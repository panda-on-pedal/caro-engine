// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import {
  EMPTY_REPORT_COUNTS,
  REPORT_BUFFER_CAP,
  type PracticeReportCounts,
  type PracticeReportEvent,
} from "../shared/practiceReport.ts";
import { logger } from "../utils/logger.ts";

const STORAGE_KEY = "caro.practiceReport";

interface ReportFile {
  version: 1;
  counts: PracticeReportCounts;
  events: PracticeReportEvent[];
}

function readStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPracticeReport(): {
  counts: PracticeReportCounts;
  events: PracticeReportEvent[];
} {
  const storage = readStorage();
  const empty = { counts: { ...EMPTY_REPORT_COUNTS }, events: [] as PracticeReportEvent[] };
  if (!storage) {
    return empty;
  }
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return empty;
  }
  try {
    const parsed = JSON.parse(raw) as ReportFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.events) || parsed.counts === undefined) {
      return empty;
    }
    // Newest-first; keep only the rolling window even if an older save held more.
    const events =
      parsed.events.length > REPORT_BUFFER_CAP
        ? parsed.events.slice(0, REPORT_BUFFER_CAP)
        : parsed.events;
    return { counts: parsed.counts, events };
  } catch {
    return empty;
  }
}

export function savePracticeReport(
  counts: PracticeReportCounts,
  events: PracticeReportEvent[]
): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  const payload: ReportFile = { version: 1, counts, events };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    logger.error("Failed to persist practice report:", error);
  }
}

export function clearPracticeReport(): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota / private-mode quirks
  }
}
