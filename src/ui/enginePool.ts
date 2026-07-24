import type { Board, Player } from "../engine/board.ts";
import type { Difficulty } from "../engine/engine.ts";
import {
  computeSettleTransition,
  DEFAULT_SETTLE_GIVE_UP_SEARCHES,
  EMPTY_POSITION_KEY,
  IDENTITY_TRANSFORM,
  MIN_EXPERIENCE_DEPTH,
  toCanonicalBoard,
  type ExperienceEntry,
  type ExperienceMode,
  type ExperienceTransform,
} from "../engine/experience/experience.ts";
import type { SearchProgressEvent, SearchResult } from "../engine/search/search.ts";
import type { PracticeReportEvent } from "../shared/practiceReport.ts";
import { logger } from "../utils/logger.ts";
import {
  isProgressMessage,
  prepareExperienceForRequest,
  type EngineMessage,
  type EngineRequest,
} from "./engineProtocol.ts";
import { PersistentExperienceStore } from "./experiencePersist.ts";

const WORKER_URL = "/engineWorker.js";

/**
 * Copy a board into plain nested arrays. Svelte `$state` boards are Proxies;
 * `Worker.postMessage` cannot structured-clone them (DataCloneError).
 */
export function toPlainBoard(board: Board): Board {
  return board.map(row => Array.from(row));
}

export class CancelledError extends Error {
  constructor() {
    super("Engine request cancelled");
    this.name = "CancelledError";
  }
}

export interface RequestMoveOptions {
  onProgress?: (event: SearchProgressEvent) => void;
  experienceMode?: ExperienceMode;
  /** When false, skip writing the search result into the experience book. */
  persistExperience?: boolean;
  /**
   * Practice only. Default true. When false, every strong cache hit replays
   * instantly and no background improvement is enqueued, so games walk to the
   * edge of the cache — and restart — much faster.
   */
  practiceImprovement?: boolean;
  /** Give-up threshold for this request. Default DEFAULT_SETTLE_GIVE_UP_SEARCHES. */
  settleGiveUpSearches?: number;
  /** Board this request belongs to; stamped onto the emitted report event so
   *  the session can render a per-board live feed. Omit for non-board requests. */
  reportBoardId?: number;
}

interface PendingEntry {
  resolve: (result: SearchResult) => void;
  reject: (error: Error) => void;
  onProgress?: (event: SearchProgressEvent) => void;
  difficulty: Difficulty;
  experienceKey?: string;
  experienceTransform?: ExperienceTransform;
  experienceMode?: ExperienceMode;
  persistExperience?: boolean;
  /** True for fire-and-forget hit-improvement jobs (preemptible). */
  background?: boolean;
  /** Baseline used for this search — if the result does not beat it, stall. */
  experienceBaseline?: ExperienceEntry;
  settleGiveUpSearches?: number;
  reportBoardId?: number;
}

interface QueuedJob {
  request: EngineRequest;
  resolve: (result: SearchResult) => void;
  reject: (error: Error) => void;
  onProgress?: (event: SearchProgressEvent) => void;
  difficulty: Difficulty;
  experienceKey?: string;
  experienceTransform?: ExperienceTransform;
  experienceMode?: ExperienceMode;
  persistExperience?: boolean;
  /** True for fire-and-forget hit-improvement jobs (preemptible). */
  background?: boolean;
  /** Baseline used for this search — if the result does not beat it, stall. */
  experienceBaseline?: ExperienceEntry;
  settleGiveUpSearches?: number;
  reportBoardId?: number;
}

interface Slot {
  worker: Worker | null;
  busy: boolean;
  currentId: number | null;
}

/** Fixed-size pool of Web Workers running the (synchronous, blocking) engine
 * search off the main thread. `cancelAll()` terminates + lazily respawns any
 * worker mid-search so a stale expert-difficulty search (up to 10s) can't
 * delay the next request — idle workers are left running. */
export class EnginePool {
  private readonly slots: Slot[];
  private readonly queue: QueuedJob[] = [];
  private readonly pending = new Map<number, PendingEntry>();
  private nextId = 0;
  private readonly experience: PersistentExperienceStore;
  private readonly onReport?: (event: PracticeReportEvent) => void;

  constructor(
    size: number,
    experience?: PersistentExperienceStore,
    onReport?: (event: PracticeReportEvent) => void
  ) {
    this.slots = Array.from({ length: size }, () => ({
      worker: null,
      busy: false,
      currentId: null,
    }));
    this.experience = experience ?? new PersistentExperienceStore();
    this.onReport = onReport;
  }

  get size(): number {
    return this.slots.length;
  }

  requestMove(
    board: Board,
    player: Player,
    difficulty: Difficulty,
    timeBudgetMs?: number,
    options?: RequestMoveOptions
  ): Promise<SearchResult> {
    const experienceMode = options?.experienceMode ?? "use";
    const persistExperience = options?.persistExperience !== false;
    const practiceImprovement = options?.practiceImprovement !== false;
    const settleGiveUpSearches = options?.settleGiveUpSearches ?? DEFAULT_SETTLE_GIVE_UP_SEARCHES;
    const prepared = prepareExperienceForRequest({
      board,
      player,
      difficulty,
      experienceMode,
      store: this.experience,
      practiceImprovement,
      settleGiveUpSearches,
    });

    if (prepared.instant !== null) {
      options?.onProgress?.({
        type: "experienceHit",
        row: prepared.instant.move.row,
        col: prepared.instant.move.col,
        depth: prepared.instant.depth,
      });
      logger.log("experience hit", {
        key: prepared.key,
        move: prepared.instant.move,
        depth: prepared.instant.depth,
        permanent: prepared.permanent,
      });
      // Reinvest: replay instantly, but keep improving the entry in the
      // background until stallCount reaches the give-up threshold.
      // Practice with improvement off replays every hit and never re-searches.
      const improvementAllowed = experienceMode !== "practice" || practiceImprovement;
      if (!prepared.permanent && persistExperience && improvementAllowed) {
        this.enqueueBackgroundImprovement(
          board,
          player,
          difficulty,
          prepared,
          experienceMode,
          settleGiveUpSearches,
          options?.reportBoardId
        );
      }
      return Promise.resolve(prepared.instant);
    }

    if (prepared.baseline !== undefined) {
      options?.onProgress?.({
        type: "experienceHit",
        row: prepared.baseline.move.row,
        col: prepared.baseline.move.col,
        depth: prepared.baseline.depth,
      });
    }

    return new Promise((resolve, reject) => {
      const request: EngineRequest = {
        id: this.nextId,
        board: toPlainBoard(board),
        player,
        difficulty,
        timeBudgetMs,
        experienceMode,
        experienceBaseline: prepared.baseline,
      };
      this.nextId += 1;
      const job: QueuedJob = {
        request,
        resolve,
        reject,
        onProgress: options?.onProgress,
        difficulty,
        experienceKey: prepared.key,
        experienceTransform: prepared.transform,
        experienceMode,
        persistExperience,
        experienceBaseline: prepared.baseline,
        settleGiveUpSearches,
        reportBoardId: options?.reportBoardId,
      };
      let idleSlot = this.slots.find(slot => !slot.busy);
      if (!idleSlot) {
        idleSlot = this.preemptBackgroundSlot();
      }
      if (idleSlot) {
        this.dispatch(idleSlot, job);
      } else {
        this.queue.push(job);
      }
    });
  }

  /** Fire-and-forget: re-search a hit position with the full difficulty
   * budget so the stored entry keeps improving. Runs only in an already-idle
   * slot (never queued — it is opportunistic) and is preempted by any
   * foreground request. Its promise is consumed here; rejections
   * (preemption, cancelAll) are expected and swallowed. */
  private enqueueBackgroundImprovement(
    board: Board,
    player: Player,
    difficulty: Difficulty,
    prepared: {
      baseline?: ExperienceEntry;
      key: string;
      transform: ExperienceTransform;
    },
    experienceMode: ExperienceMode,
    settleGiveUpSearches: number,
    /** When the hit came from a visible board turn, stamp the background
     *  report onto that board's thoughts feed. */
    reportBoardId?: number
  ): void {
    const baseline = prepared.baseline;
    if (baseline === undefined) {
      return;
    }
    const idleSlot = this.slots.find(slot => !slot.busy);
    if (!idleSlot) {
      return;
    }
    // Search the canonical frame so the persisted TT slice is orientation-
    // independent. The baseline move must be canonical too (it floors the result).
    const canonicalBoard = toCanonicalBoard(toPlainBoard(board), prepared.transform);
    const canonicalBaseline: ExperienceEntry = {
      move: prepared.transform.toCanonical(baseline.move),
      score: baseline.score,
      depth: baseline.depth,
    };
    const request: EngineRequest = {
      id: this.nextId,
      board: canonicalBoard,
      player,
      difficulty,
      // Background reinvest is not user-facing — use the full difficulty budget.
      stepTimeByOwnStones: false,
      experienceMode,
      experienceBaseline: canonicalBaseline,
      bookDeepening: true,
      canonicalKey: prepared.key,
    };
    this.nextId += 1;
    new Promise<SearchResult>((resolve, reject) => {
      logger.log("enqueueBackgroundImprovement", {
        request,
        idleSlot,
      });
      this.dispatch(idleSlot, {
        request,
        resolve,
        reject,
        difficulty,
        experienceKey: prepared.key,
        // Result move is already canonical → store unchanged.
        experienceTransform: IDENTITY_TRANSFORM,
        experienceMode,
        persistExperience: true,
        background: true,
        experienceBaseline: canonicalBaseline,
        settleGiveUpSearches,
        reportBoardId,
      });
    }).catch(error => {
      if (!(error instanceof CancelledError)) {
        logger.error("Background experience search failed:", error);
      }
    });
  }

  /** Terminate a slot running a background improvement so a foreground move
   * request never waits behind one. Returns the freed slot, if any. */
  private preemptBackgroundSlot(): Slot | undefined {
    const slot = this.slots.find(
      candidate =>
        candidate.busy &&
        candidate.currentId !== null &&
        this.pending.get(candidate.currentId)?.background === true
    );
    if (!slot) {
      return undefined;
    }
    const id = slot.currentId;
    slot.worker?.terminate();
    slot.worker = null;
    slot.busy = false;
    slot.currentId = null;
    if (id !== null) {
      const entry = this.pending.get(id);
      this.pending.delete(id);
      entry?.reject(new CancelledError());
    }
    return slot;
  }

  /** Fold a completed search result into the book: store/improve/stall/freeze,
   * and emit a practice-report event. Replaces rememberResult +
   * maybeMarkSettled. */
  private applyResult(entry: PendingEntry, result: SearchResult): void {
    if (
      entry.persistExperience === false ||
      entry.experienceKey === undefined ||
      entry.experienceTransform === undefined ||
      entry.experienceMode === "off" ||
      entry.experienceMode === undefined ||
      entry.experienceKey === EMPTY_POSITION_KEY ||
      result.depth < MIN_EXPERIENCE_DEPTH
    ) {
      return;
    }
    const key = entry.experienceKey;
    const difficulty = entry.difficulty;
    const giveUp = entry.settleGiveUpSearches ?? DEFAULT_SETTLE_GIVE_UP_SEARCHES;
    const prev = this.experience.get(difficulty, key);
    const cand: ExperienceEntry = {
      move: entry.experienceTransform.toCanonical(result.move),
      score: result.score,
      depth: result.depth,
      nodes: result.nodesVisited,
    };
    const transition = computeSettleTransition(prev, cand, giveUp);
    if (transition.action === "put") {
      this.experience.put(difficulty, key, {
        ...cand,
        settleLevel: transition.settleLevel,
        stallCount: transition.stallCount,
      });
    } else if (transition.action === "setStall") {
      this.experience.setStallCount(difficulty, key, transition.stallCount);
    }
    if (transition.emit && this.onReport) {
      const moveChanged =
        prev !== undefined &&
        (cand.move.row !== prev.move.row || cand.move.col !== prev.move.col);
      this.onReport({
        kind: transition.kind,
        difficulty,
        key,
        oldScore: prev?.score ?? null,
        newScore: cand.score,
        oldDepth: prev?.depth ?? null,
        newDepth: cand.depth,
        oldNodes: prev?.nodes ?? null,
        newNodes: cand.nodes ?? 0,
        moveChanged,
        settleLevel: transition.settleLevel,
        stallCount: transition.stallCount,
        giveUp,
        boardId: entry.reportBoardId,
        at: Date.now(),
      });
    }
  }

  private ensureWorker(slot: Slot): Worker {
    if (slot.worker) {
      return slot.worker;
    }
    const worker = new Worker(WORKER_URL);
    worker.onmessage = (event: MessageEvent<EngineMessage>): void => {
      this.handleMessage(slot, event.data);
    };
    worker.onerror = (event: ErrorEvent): void => {
      logger.error("Engine worker error:", event.message);
      const id = slot.currentId;
      slot.worker = null;
      slot.busy = false;
      slot.currentId = null;
      if (id !== null) {
        const entry = this.pending.get(id);
        this.pending.delete(id);
        entry?.reject(new Error(event.message || "Engine worker error"));
      }
      this.pump();
    };
    slot.worker = worker;
    return worker;
  }

  private dispatch(slot: Slot, job: QueuedJob): void {
    slot.busy = true;
    slot.currentId = job.request.id;
    this.pending.set(job.request.id, {
      resolve: job.resolve,
      reject: job.reject,
      onProgress: job.onProgress,
      difficulty: job.difficulty,
      experienceKey: job.experienceKey,
      experienceTransform: job.experienceTransform,
      experienceMode: job.experienceMode,
      persistExperience: job.persistExperience,
      background: job.background,
      experienceBaseline: job.experienceBaseline,
      settleGiveUpSearches: job.settleGiveUpSearches,
      reportBoardId: job.reportBoardId,
    });
    this.ensureWorker(slot).postMessage(job.request);
  }

  private handleMessage(slot: Slot, message: EngineMessage): void {
    if (isProgressMessage(message)) {
      const entry = this.pending.get(message.id);
      entry?.onProgress?.(message.event);
      return;
    }

    const entry = this.pending.get(message.id);
    this.pending.delete(message.id);
    slot.busy = false;
    slot.currentId = null;
    if (entry) {
      if (message.ok) {
        this.applyResult(entry, message.result);
        entry.resolve(message.result);
      } else {
        entry.reject(new Error(message.error));
      }
    }
    this.pump();
  }

  private pump(): void {
    const idleSlot = this.slots.find(slot => !slot.busy);
    if (!idleSlot) {
      return;
    }
    const job = this.queue.shift();
    if (job) {
      this.dispatch(idleSlot, job);
    }
  }

  /** Clears the queue and rejects everything in flight with `CancelledError`.
   * Busy workers are terminated (not merely orphaned) and respawned lazily
   * on next use, so a running search can never delay a later request. */
  cancelAll(): void {
    const queued = this.queue.splice(0, this.queue.length);
    for (const job of queued) {
      this.pending.delete(job.request.id);
      job.reject(new CancelledError());
    }

    for (const slot of this.slots) {
      if (!slot.busy) {
        continue;
      }
      const id = slot.currentId;
      slot.worker?.terminate();
      slot.worker = null;
      slot.busy = false;
      slot.currentId = null;
      if (id !== null) {
        const entry = this.pending.get(id);
        this.pending.delete(id);
        entry?.reject(new CancelledError());
      }
    }
  }

  /** Like `cancelAll()`, but also kills idle workers — for retiring the
   * pool entirely (e.g. resizing). Rejects everything in flight, not just
   * busy-slot requests, so no caller is left awaiting forever. */
  terminate(): void {
    this.cancelAll();
    this.experience.flush();
    for (const slot of this.slots) {
      slot.worker?.terminate();
      slot.worker = null;
    }
  }
}
