/** Structured search progress for UI narration. No user-facing copy. */

export type InsightKind = "win" | "open-four" | "four" | "open-three" | "fork" | "block";

export type SearchProgressEvent =
  | { type: "phase"; phase: "scanning" | "searching" | "quiet" }
  | { type: "candidates"; count: number; source: string }
  | { type: "examining"; row: number; col: number }
  | { type: "insight"; row: number; col: number; kind: InsightKind }
  | { type: "bestSoFar"; row: number; col: number }
  | { type: "deeper"; depth: number }
  | { type: "experienceHit"; row: number; col: number; depth: number }
  | { type: "searchStats"; depth: number; nodes: number };

/** Throttles high-frequency examining/insight emits (~6–7/sec). */
export class ProgressReporter {
  private lastThrottleMs = 0;

  constructor(
    private readonly onProgress: ((event: SearchProgressEvent) => void) | undefined,
    private readonly minIntervalMs = 150
  ) {}

  emit(event: SearchProgressEvent): void {
    if (!this.onProgress) {
      return;
    }
    if (event.type === "examining" || event.type === "insight") {
      const now = Date.now();
      if (now - this.lastThrottleMs < this.minIntervalMs) {
        return;
      }
      this.lastThrottleMs = now;
    }
    this.onProgress(event);
  }
}
