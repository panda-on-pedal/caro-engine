import { isLegalMove } from '../engine/board.ts';
import { applyMove, newGame } from '../engine/state.ts';
import {
  handleEngineRequest,
  isProgressMessage,
  type EngineMessage,
} from './engineProtocol.ts';
import { CancelledError, EnginePool, toPlainBoard } from './enginePool.ts';

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
