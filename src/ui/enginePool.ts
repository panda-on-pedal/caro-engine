import type { Board, Player } from '../engine/board.ts';
import type { Difficulty } from '../engine/engine.ts';
import type { ExperienceMode } from '../engine/experience.ts';
import type { SearchProgressEvent, SearchResult } from '../engine/search.ts';
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
  experienceKey?: string;
  experienceMode?: ExperienceMode;
  persistExperience?: boolean;
}

interface QueuedJob {
  request: EngineRequest;
  resolve: (result: SearchResult) => void;
  reject: (error: Error) => void;
  onProgress?: (event: SearchProgressEvent) => void;
  experienceKey?: string;
  experienceMode?: ExperienceMode;
  persistExperience?: boolean;
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
        experienceKey: prepared.key,
        experienceMode,
        persistExperience,
      };
      const idleSlot = this.slots.find((slot) => !slot.busy);
      if (idleSlot) {
        this.dispatch(idleSlot, job);
      } else {
        this.queue.push(job);
      }
    });
  }

  private rememberResult(
    key: string | undefined,
    mode: ExperienceMode | undefined,
    result: SearchResult,
    persist: boolean,
  ): void {
    if (!persist || key === undefined || mode === 'off' || mode === undefined) {
      return;
    }
    this.experience.put(key, {
      move: result.move,
      score: result.score,
      depth: result.depth,
    });
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
      experienceKey: job.experienceKey,
      experienceMode: job.experienceMode,
      persistExperience: job.persistExperience,
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
          entry.experienceKey,
          entry.experienceMode,
          message.result,
          entry.persistExperience !== false,
        );
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
