import "fake-indexeddb/auto";
import { EnginePool } from "./enginePool.ts";
import { createEmptyBoard } from "../engine/board.ts";
import type { SearchResult } from "../engine/search/search.ts";
import type { Board, Player } from "../engine/board.ts";
import type { Difficulty } from "../engine/engine.ts";
import type { Move } from "../engine/state.ts";
import type { EngineMessage } from "./engineProtocol.ts";

/** Stand-in for the Web Worker so the single-worker fallback path can resolve
 *  in the jest environment (Workers are unavailable). Mirrors enginePool.spec. */
class FakeWorker {
  onmessage: ((event: MessageEvent<EngineMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(request: { id: number }): void {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          id: request.id,
          ok: true,
          result: {
            move: { row: 7, col: 6 },
            score: 0,
            depth: 0,
            principalVariation: [{ row: 7, col: 6 }],
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
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
});

afterEach(() => {
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: OriginalWorker });
});

class StubPool extends EnginePool {
  public sliceCalls: Move[][] = [];
  public depthCalls: number[] = [];

  protected override searchSlice(
    _board: Board,
    _player: Player,
    _difficulty: Difficulty,
    _budget: number | undefined,
    slice: Move[],
    _workerIndex: number,
    depth: number
  ): Promise<SearchResult> {
    this.sliceCalls.push(slice);
    this.depthCalls.push(depth);
    // Score each slice by its first candidate's column so we can assert the winner.
    const move = slice[0];
    return Promise.resolve({
      move,
      score: move.col * 10,
      depth,
      complete: true,
      principalVariation: [move],
      nodesVisited: 1,
    });
  }
}

describe("EnginePool parallel route", () => {
  it("partitions a tactical root and returns the highest-scoring slice move", async () => {
    const pool = new StubPool(4);
    const board = createEmptyBoard();
    // Player 1 has an open three; player 2 to move faces a tactical position
    // (multiple candidate responses -> narrowing source "tactical", >=2 moves).
    board[7][7] = 1;
    board[7][8] = 1;
    board[7][9] = 1;
    const result = await pool.requestMove(board, 2, "expert", undefined, {
      experienceMode: "use",
      parallelism: 3,
    });
    expect(pool.sliceCalls.length).toBeGreaterThan(1); // fanned out
    // Synced depths: same slice set re-searched per depth (expert maxDepth=8).
    expect(pool.depthCalls[0]).toBe(1);
    expect(new Set(pool.depthCalls).size).toBeGreaterThan(1);
    const best = pool.sliceCalls
      .map(s => s[0])
      .reduce((a, b) => (b.col > a.col ? b : a));
    expect(result.move).toEqual(best);
    pool.terminate();
  });

  it("keeps the prior depth when a synced depth is incomplete", async () => {
    class IncompleteAtThreePool extends StubPool {
      protected override searchSlice(
        _board: Board,
        _player: Player,
        _difficulty: Difficulty,
        _budget: number | undefined,
        slice: Move[],
        _workerIndex: number,
        depth: number
      ): Promise<SearchResult> {
        this.sliceCalls.push(slice);
        this.depthCalls.push(depth);
        const move = slice[0];
        return Promise.resolve({
          move,
          // Depth 2 prefers higher col; depth 3 (incomplete) would flip if kept.
          score: depth >= 3 ? -move.col * 100 : move.col * 10,
          depth,
          complete: depth < 3,
          principalVariation: [move],
          nodesVisited: 1,
        });
      }
    }
    const pool = new IncompleteAtThreePool(4);
    const board = createEmptyBoard();
    board[7][7] = 1;
    board[7][8] = 1;
    board[7][9] = 1;
    const result = await pool.requestMove(board, 2, "expert", undefined, {
      experienceMode: "use",
      parallelism: 3,
    });
    expect(result.depth).toBe(2);
    expect(pool.depthCalls).toContain(3);
    expect(Math.max(...pool.depthCalls)).toBe(3);
    pool.terminate();
  });

  it("falls through to a single worker when only one slot is idle", async () => {
    // Pool of 1 -> idle < 2 -> runParallelSearch returns null. searchSlice is
    // never called; the request takes the normal single-worker path (which
    // spawns a real worker). We only assert no fan-out happened.
    const pool = new StubPool(1);
    const board = createEmptyBoard();
    board[7][7] = 1;
    board[7][8] = 1;
    board[7][9] = 1;
    const promise = pool.requestMove(board, 2, "expert", 200, {
      experienceMode: "use",
      parallelism: 3,
    });
    await promise;
    expect(pool.sliceCalls.length).toBe(0);
    pool.terminate();
  });
});
