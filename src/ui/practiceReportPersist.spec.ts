import {
  loadPracticeReport,
  savePracticeReport,
  clearPracticeReport,
} from "./practiceReportPersist.ts";
import { EMPTY_REPORT_COUNTS, type PracticeReportEvent } from "../shared/practiceReport.ts";

const ev: PracticeReportEvent = {
  kind: "new",
  difficulty: "hard",
  key: "k",
  oldScore: null,
  newScore: 5,
  oldDepth: null,
  newDepth: 4,
  oldNodes: null,
  newNodes: 4200,
  moveChanged: false,
  settleLevel: 0,
  stallCount: 0,
  giveUp: 3,
  at: 1,
};

describe("practiceReportPersist", () => {
  let memory: Record<string, string>;

  beforeEach(() => {
    memory = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem(key: string): string | null {
          return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
        },
        setItem(key: string, value: string): void {
          memory[key] = value;
        },
        removeItem(key: string): void {
          delete memory[key];
        },
        clear(): void {
          memory = {};
        },
      },
    });
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("returns empty state when nothing is stored", () => {
    expect(loadPracticeReport()).toEqual({ counts: EMPTY_REPORT_COUNTS, events: [] });
  });

  it("round-trips counts and events", () => {
    savePracticeReport({ new: 1, improved: 0, stalled: 0, settled: 0 }, [ev]);
    expect(loadPracticeReport()).toEqual({
      counts: { new: 1, improved: 0, stalled: 0, settled: 0 },
      events: [ev],
    });
  });

  it("clear wipes stored state", () => {
    savePracticeReport({ new: 1, improved: 0, stalled: 0, settled: 0 }, [ev]);
    clearPracticeReport();
    expect(loadPracticeReport()).toEqual({ counts: EMPTY_REPORT_COUNTS, events: [] });
  });
});
