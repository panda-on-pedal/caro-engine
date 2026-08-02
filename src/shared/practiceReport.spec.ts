// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import {
  EMPTY_REPORT_COUNTS,
  REPORT_BUFFER_CAP,
  pushCapped,
  summarizeReport,
  tallyReportEvent,
  type PracticeReportEvent,
} from "./practiceReport.ts";

const ev = (kind: PracticeReportEvent["kind"]): PracticeReportEvent => ({
  kind,
  difficulty: "hard",
  key: "k",
  oldScore: 1,
  newScore: 2,
  oldDepth: 3,
  newDepth: 4,
  oldNodes: 900,
  newNodes: 4200,
  moveChanged: false,
  settleLevel: 1,
  stallCount: 0,
  giveUp: 3,
  at: 0,
});

it("tallies counts per kind", () => {
  let c = EMPTY_REPORT_COUNTS;
  c = tallyReportEvent(c, ev("new"));
  c = tallyReportEvent(c, ev("improved"));
  c = tallyReportEvent(c, ev("improved"));
  c = tallyReportEvent(c, ev("stalled"));
  c = tallyReportEvent(c, ev("settled"));
  expect(c).toEqual({ new: 1, improved: 2, stalled: 1, settled: 1 });
});

it("summarizeReport folds in the book size", () => {
  expect(summarizeReport({ new: 1, improved: 2, stalled: 1, settled: 1 }, 42)).toEqual({
    new: 1,
    improved: 2,
    stalled: 1,
    settled: 1,
    bookEntries: 42,
  });
});

it("pushCapped keeps newest first and trims to the cap", () => {
  let buf: number[] = [];
  for (let i = 0; i < REPORT_BUFFER_CAP + 5; i += 1) buf = pushCapped(buf, i);
  expect(buf.length).toBe(REPORT_BUFFER_CAP);
  expect(buf[0]).toBe(REPORT_BUFFER_CAP + 4);
});
