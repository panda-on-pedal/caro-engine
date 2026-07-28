import type { SearchProgressEvent } from "../engine/search/searchProgress.ts";
import { formatReportLine, formatThought } from "./thoughts.ts";

describe("formatThought", () => {
  const cases: SearchProgressEvent[] = [
    { type: "phase", phase: "scanning" },
    { type: "phase", phase: "searching" },
    { type: "phase", phase: "quiet" },
    { type: "candidates", count: 7, source: "tactical" },
    { type: "examining", row: 3, col: 8 },
    { type: "insight", row: 3, col: 8, kind: "open-four" },
    { type: "insight", row: 1, col: 2, kind: "win" },
    { type: "insight", row: 1, col: 2, kind: "four" },
    { type: "insight", row: 1, col: 2, kind: "open-three" },
    { type: "insight", row: 1, col: 2, kind: "fork" },
    { type: "insight", row: 1, col: 2, kind: "block" },
    { type: "bestSoFar", row: 10, col: 11 },
    { type: "deeper", depth: 3 },
    { type: "experienceHit", row: 5, col: 7, depth: 6 },
    { type: "pvFollowHit", row: 5, col: 7, depth: 6 },
    { type: "searchStats", depth: 6, nodes: 4200 },
  ];

  it.each(cases)("maps %j to a non-empty English string", event => {
    const text = formatThought(event);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\{/);
  });

  it("interpolates cell coordinates", () => {
    expect(formatThought({ type: "examining", row: 4, col: 9 })).toContain("4,9");
    expect(formatThought({ type: "bestSoFar", row: 4, col: 9 })).toContain("4,9");
    expect(formatThought({ type: "experienceHit", row: 4, col: 9, depth: 4 })).toContain("4,9");
    expect(formatThought({ type: "pvFollowHit", row: 4, col: 9, depth: 4 })).toContain("4,9");
    expect(formatThought({ type: "candidates", count: 12, source: "forced" })).toContain("12");
  });

  it("formats a searchStats event", () => {
    expect(formatThought({ type: "searchStats", depth: 6, nodes: 4200 })).toBe(
      "Depth 6 · 4,200 nodes…"
    );
  });
});

describe("formatReportLine", () => {
  it("formats an improved report line with move-changed and level", () => {
    expect(
      formatReportLine({
        kind: "improved",
        difficulty: "hard",
        key: "k",
        oldScore: 90,
        newScore: 120,
        oldDepth: 4,
        newDepth: 6,
        oldNodes: 2100,
        newNodes: 48000,
        moveChanged: true,
        settleLevel: 3,
        stallCount: 0,
        giveUp: 3,
        boardId: 1,
        at: 0,
      })
    ).toBe("Improved — +120 · d4→d6 · L3 · move changed…");
  });

  it("formats a stalled report line with the give-up counter", () => {
    expect(
      formatReportLine({
        kind: "stalled",
        difficulty: "hard",
        key: "k",
        oldScore: 120,
        newScore: 120,
        oldDepth: 6,
        newDepth: 6,
        oldNodes: 48000,
        newNodes: 49000,
        moveChanged: false,
        settleLevel: 3,
        stallCount: 1,
        giveUp: 3,
        boardId: 1,
        at: 0,
      })
    ).toBe("No gain — d6 · give up 1/3…");
  });
});
