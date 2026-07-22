import { isLegalMove } from '../engine/board.ts';
import { applyMove, newGame } from '../engine/state.ts';
import {
  handleEngineRequest,
  isProgressMessage,
  prepareExperienceForRequest,
  type EngineMessage,
  type EngineRequest,
} from './engineProtocol.ts';
import { CancelledError, EnginePool, toPlainBoard } from './enginePool.ts';
import { PersistentExperienceStore } from './experiencePersist.ts';

describe('toPlainBoard', () => {
  it('makes proxied boards structured-cloneable for Worker.postMessage', () => {
    const plain = newGame().board;
    plain[5][5] = 1;
    const proxied = new Proxy(plain, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && /^\d+$/.test(prop) && Array.isArray(value)) {
          return new Proxy(value, {});
        }
        return value;
      },
    });

    expect(() => structuredClone(proxied)).toThrow();
    expect(() => structuredClone(toPlainBoard(proxied))).not.toThrow();
    expect(toPlainBoard(proxied)[5][5]).toBe(1);
  });
});

describe('handleEngineRequest progress', () => {
  it('forwards onProgress events while still returning a final result', () => {
    let state = newGame();
    state = applyMove(state, { row: 10, col: 10 }, 1);
    state = applyMove(state, { row: 0, col: 0 }, 2);

    const events: EngineMessage[] = [];
    const response = handleEngineRequest(
      {
        id: 7,
        board: state.board,
        player: state.nextPlayer,
        difficulty: 'easy',
      },
      (event) => {
        events.push({ id: 7, type: 'progress', event });
      },
    );

    expect(response.ok).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((message) => isProgressMessage(message))).toBe(true);
    if (response.ok) {
      expect(isLegalMove(state.board, response.result.move.row, response.result.move.col)).toBe(
        true,
      );
    }
  });
});

describe('EnginePool progress routing', () => {
  class FakeWorker {
    onmessage: ((event: MessageEvent<EngineMessage>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;

    postMessage(request: { id: number }): void {
      queueMicrotask(() => {
        this.onmessage?.({
          data: {
            id: request.id,
            type: 'progress',
            event: { type: 'phase', phase: 'scanning' },
          },
        } as MessageEvent<EngineMessage>);
        this.onmessage?.({
          data: {
            id: request.id,
            ok: true,
            result: {
              move: { row: 7, col: 7 },
              score: 0,
              depth: 0,
              principalVariation: [{ row: 7, col: 7 }],
              nodesVisited: 1,
            },
          },
        } as MessageEvent<EngineMessage>);
      });
    }

    terminate(): void {
      // no-op
    }
  }

  const OriginalWorker = globalThis.Worker;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: FakeWorker,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: OriginalWorker,
    });
  });

  it('forwards progress for the matching in-flight id', async () => {
    const pool = new EnginePool(1);
    const progress: string[] = [];
    const board = newGame().board;
    const result = await pool.requestMove(board, 1, 'easy', undefined, {
      onProgress: (event) => {
        progress.push(event.type);
      },
    });
    expect(result.move).toEqual({ row: 7, col: 7 });
    expect(progress).toEqual(['phase']);
    pool.terminate();
  });

  it('ignores progress after cancel removes the pending id', async () => {
    const holders: {
      worker: {
        onmessage: ((event: MessageEvent<EngineMessage>) => void) | null;
        lastId: number | null;
        emitStaleProgress(): void;
      } | null;
    } = { worker: null };

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: class {
        onmessage: ((event: MessageEvent<EngineMessage>) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        lastId: number | null = null;

        constructor() {
          holders.worker = this;
        }

        postMessage(request: { id: number }): void {
          this.lastId = request.id;
        }

        emitStaleProgress(): void {
          if (this.lastId === null) {
            return;
          }
          this.onmessage?.({
            data: {
              id: this.lastId,
              type: 'progress',
              event: { type: 'phase', phase: 'searching' },
            },
          } as MessageEvent<EngineMessage>);
        }

        terminate(): void {
          // no-op
        }
      },
    });

    const pool = new EnginePool(1);
    const progress: string[] = [];
    const pending = pool.requestMove(newGame().board, 1, 'easy', undefined, {
      onProgress: (event) => {
        progress.push(event.type);
      },
    });
    pool.cancelAll();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    holders.worker?.emitStaleProgress();
    expect(progress).toEqual([]);
    pool.terminate();
  });
});

describe('EnginePool background improvement', () => {
  class RecordingWorker {
    static instances: RecordingWorker[] = [];
    onmessage: ((event: MessageEvent<EngineMessage>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    posted: EngineRequest[] = [];
    terminated = false;

    constructor() {
      RecordingWorker.instances.push(this);
    }

    postMessage(request: EngineRequest): void {
      this.posted.push(request);
    }

    terminate(): void {
      this.terminated = true;
    }
  }

  const OriginalWorker = globalThis.Worker;

  beforeEach(() => {
    RecordingWorker.instances = [];
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: RecordingWorker,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: OriginalWorker,
    });
  });

  /** Board with one stored hit at (4,4), depth 3, keyed like the pool keys it. */
  function seedHit() {
    const store = new PersistentExperienceStore();
    let state = newGame();
    state = applyMove(state, { row: 5, col: 5 }, 1);
    state = applyMove(state, { row: 5, col: 6 }, 2);
    const prepared = prepareExperienceForRequest({
      board: state.board,
      player: state.nextPlayer,
      difficulty: 'easy',
      experienceMode: 'use',
      store,
    });
    store.put('easy', prepared.key, {
      move: prepared.transform.toCanonical({ row: 4, col: 4 }),
      score: 10,
      depth: 3,
    });
    return { store, board: state.board, player: state.nextPlayer, key: prepared.key };
  }

  it('replays a hit instantly and dispatches a full-budget background search', async () => {
    const { store, board, player } = seedHit();
    const pool = new EnginePool(1, store);

    const result = await pool.requestMove(board, player, 'easy', undefined, {
      experienceMode: 'use',
    });
    expect(result.move).toEqual({ row: 4, col: 4 });

    expect(RecordingWorker.instances).toHaveLength(1);
    const background = RecordingWorker.instances[0].posted;
    expect(background).toHaveLength(1);
    expect(background[0].experienceBaseline?.move).toEqual({ row: 4, col: 4 });
    expect(background[0].stepTimeByOwnStones).toBe(false);
    pool.terminate();
  });

  it('preempts the background search when a foreground request arrives', async () => {
    const { store, board, player } = seedHit();
    const pool = new EnginePool(1, store);
    await pool.requestMove(board, player, 'easy', undefined, { experienceMode: 'use' });
    const backgroundWorker = RecordingWorker.instances[0];
    expect(backgroundWorker.posted).toHaveLength(1);

    // Empty board → no hit → real worker request that must not wait.
    const foreground = pool.requestMove(newGame().board, 1, 'easy', undefined, {
      experienceMode: 'use',
    });
    expect(backgroundWorker.terminated).toBe(true);
    expect(RecordingWorker.instances).toHaveLength(2);
    const foregroundWorker = RecordingWorker.instances[1];
    expect(foregroundWorker.posted).toHaveLength(1);
    expect(foregroundWorker.posted[0].experienceBaseline).toBeUndefined();

    foregroundWorker.onmessage?.({
      data: {
        id: foregroundWorker.posted[0].id,
        ok: true,
        result: {
          move: { row: 9, col: 9 },
          score: 1,
          depth: 2,
          principalVariation: [{ row: 9, col: 9 }],
          nodesVisited: 1,
        },
      },
    } as MessageEvent<EngineMessage>);
    await expect(foreground).resolves.toMatchObject({ move: { row: 9, col: 9 } });
    pool.terminate();
  });

  it('settles the entry when background cannot out-depth it, then skips background', async () => {
    const { store, board, player, key } = seedHit();
    const pool = new EnginePool(1, store);
    await pool.requestMove(board, player, 'easy', undefined, { experienceMode: 'use' });
    const worker = RecordingWorker.instances[0];
    const backgroundRequest = worker.posted[0];

    // Background search comes back floored at the baseline — no out-depth.
    worker.onmessage?.({
      data: {
        id: backgroundRequest.id,
        ok: true,
        result: {
          move: { row: 4, col: 4 },
          score: 10,
          depth: 3,
          principalVariation: [{ row: 4, col: 4 }],
          nodesVisited: 100,
        },
      },
    } as MessageEvent<EngineMessage>);

    expect(store.get('easy', key)?.settled).toBe(true);

    // Second hit: still instant, but no new background dispatch anywhere.
    const again = await pool.requestMove(board, player, 'easy', undefined, {
      experienceMode: 'use',
    });
    expect(again.move).toEqual({ row: 4, col: 4 });
    const totalPosted = RecordingWorker.instances.reduce(
      (n, w) => n + w.posted.length,
      0,
    );
    expect(totalPosted).toBe(1);
    pool.terminate();
  });
});
