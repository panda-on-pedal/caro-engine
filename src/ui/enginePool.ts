import type { Board, Player } from '../engine/board.ts';
import type { Difficulty } from '../engine/engine.ts';
import {
  EMPTY_POSITION_KEY,
  IDENTITY_TRANSFORM,
  MIN_EXPERIENCE_DEPTH,
  experienceBeatsBaseline,
  toCanonicalBoard,
  type ExperienceEntry,
  type ExperienceMode,
  type ExperienceTransform,
} from '../engine/experience/experience.ts';
import type { SearchProgressEvent, SearchResult } from '../engine/search/search.ts';
import { logger } from '../utils/logger.ts';
import {
  isProgressMessage,
  prepareExperienceForRequest,
  type EngineMessage,
  type EngineRequest,
} from './engineProtocol.ts';
import { PersistentExperienceStore } from './experiencePersist.ts';

const WORKER_URL = '/engineWorker.js';

/**
 * Copy a board into plain nested arrays. Svelte `$state` boards are Proxies;
 * `Worker.postMessage` cannot structured-clone them (DataCloneError).
 */
export function toPlainBoard(board: Board): Board {
  return board.map((row) => Array.from(row));
}

export class CancelledError extends Error {
  constructor() {
    super('Engine request cancelled');
    this.name = 'CancelledError';
  }
}

export interface RequestMoveOptions {
  onProgress?: (event: SearchProgressEvent) => void;
  experienceMode?: ExperienceMode;
  /** When false, skip writing the search result into the experience book. */
  persistExperience?: boolean;
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
  /** Cached depth the background search must out-depth, else the entry settles. */
  baselineDepth?: number;
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
  /** Cached depth the background search must out-depth, else the entry settles. */
  baselineDepth?: number;
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

  constructor(size: number, experience?: PersistentExperienceStore) {
    this.slots = Array.from({ length: size }, () => ({
      worker: null,
      busy: false,
      currentId: null,
    }));
    this.experience = experience ?? new PersistentExperienceStore();
  }

  get size(): number {
    return this.slots.length;
  }

  requestMove(
    board: Board,
    player: Player,
    difficulty: Difficulty,
    timeBudgetMs?: number,
    options?: RequestMoveOptions,
  ): Promise<SearchResult> {
    const experienceMode = options?.experienceMode ?? 'use';
    const persistExperience = options?.persistExperience !== false;
    const prepared = prepareExperienceForRequest({
      board,
      player,
      difficulty,
      experienceMode,
      store: this.experience,
    });

    if (prepared.instant !== null) {
      options?.onProgress?.({
        type: 'experienceHit',
        row: prepared.instant.move.row,
        col: prepared.instant.move.col,
        depth: prepared.instant.depth,
      });
      logger.log('experience hit', {
        key: prepared.key,
        move: prepared.instant.move,
        depth: prepared.instant.depth,
        settled: prepared.settled,
      });
      // Reinvest: replay instantly, but keep improving the entry in the
      // background until a full-budget search can no longer out-depth it.
      if (!prepared.settled && persistExperience) {
        this.enqueueBackgroundImprovement(
          board,
          player,
          difficulty,
          prepared,
          experienceMode,
        );
      }
      return Promise.resolve(prepared.instant);
    }

    if (prepared.baseline !== undefined) {
      options?.onProgress?.({
        type: 'experienceHit',
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
      };
      let idleSlot = this.slots.find((slot) => !slot.busy);
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
  ): void {
    const baseline = prepared.baseline;
    if (baseline === undefined) {
      return;
    }
    const idleSlot = this.slots.find((slot) => !slot.busy);
    if (!idleSlot) {
      return;
    }
    // Search the canonical frame so the persisted TT slice is orientation-
    // independent. The baseline move must be canonical too (it floors the result).
    const canonicalBoard = toCanonicalBoard(
      toPlainBoard(board),
      prepared.transform,
    );
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
      logger.log('enqueueBackgroundImprovement', {
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
        baselineDepth: baseline.depth,
      });
    }).catch((error) => {
      if (!(error instanceof CancelledError)) {
        logger.error('Background experience search failed:', error);
      }
    });
  }

  /** Terminate a slot running a background improvement so a foreground move
   * request never waits behind one. Returns the freed slot, if any. */
  private preemptBackgroundSlot(): Slot | undefined {
    const slot = this.slots.find(
      (candidate) =>
        candidate.busy &&
        candidate.currentId !== null &&
        this.pending.get(candidate.currentId)?.background === true,
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

  private rememberResult(
    difficulty: Difficulty,
    key: string | undefined,
    transform: ExperienceTransform | undefined,
    mode: ExperienceMode | undefined,
    result: SearchResult,
    persist: boolean,
  ): void {
    if (
      !persist ||
      key === undefined ||
      transform === undefined ||
      mode === 'off' ||
      mode === undefined ||
      // Skip the opening (empty board) and depth-0 quiet/fallback moves — no
      // real search backs them, so they only add noise to the book.
      key === EMPTY_POSITION_KEY ||
      result.depth < MIN_EXPERIENCE_DEPTH
    ) {
      return;
    }
    // Store the move in the canonical frame so any symmetric position replays it.
    const previous = this.experience.get(difficulty, key);
    const next = {
      move: transform.toCanonical(result.move),
      score: result.score,
      depth: result.depth,
    };
    const changed = this.experience.put(difficulty, key, next);
    if (changed && previous !== undefined && experienceBeatsBaseline(next, previous)) {
      logger.log('experience improved', {
        difficulty,
        key,
        move: next.move,
        depth: next.depth,
        score: next.score,
        previousDepth: previous.depth,
        previousScore: previous.score,
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
      logger.error('Engine worker error:', event.message);
      const id = slot.currentId;
      slot.worker = null;
      slot.busy = false;
      slot.currentId = null;
      if (id !== null) {
        const entry = this.pending.get(id);
        this.pending.delete(id);
        entry?.reject(new Error(event.message || 'Engine worker error'));
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
      baselineDepth: job.baselineDepth,
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
        this.rememberResult(
          entry.difficulty,
          entry.experienceKey,
          entry.experienceTransform,
          entry.experienceMode,
          message.result,
          entry.persistExperience !== false,
        );
        if (
          entry.background === true &&
          entry.baselineDepth !== undefined &&
          entry.experienceKey !== undefined &&
          message.result.depth <= entry.baselineDepth
        ) {
          // The background re-search failed to out-depth the entry: it is as
          // verified as this device can make it. Stop reinvesting until a
          // better entry replaces it (which clears the flag).
          logger.log('experience settled', {
            difficulty: entry.difficulty,
            key: entry.experienceKey,
            baselineDepth: entry.baselineDepth,
            resultDepth: message.result.depth,
          });
          this.experience.markSettled(entry.difficulty, entry.experienceKey);
        }
        entry.resolve(message.result);
      } else {
        entry.reject(new Error(message.error));
      }
    }
    this.pump();
  }

  private pump(): void {
    const idleSlot = this.slots.find((slot) => !slot.busy);
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
