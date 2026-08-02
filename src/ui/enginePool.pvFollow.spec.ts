// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { placeMove } from "../engine/board.ts";
import { newGame } from "../engine/state.ts";
import {
  prepareExperienceForRequest,
  type EngineMessage,
  type EngineRequest,
} from "./engineProtocol.ts";
import { EnginePool, PV_FOLLOW_DELAY_MS, toPlainBoard } from "./enginePool.ts";
import { PersistentExperienceStore } from "./experiencePersist.ts";

const e0 = { row: 7, col: 7 };
const h1 = { row: 7, col: 8 };
const e2 = { row: 8, col: 8 };
const h3 = { row: 8, col: 9 };
const e4 = { row: 9, col: 9 };

describe("EnginePool PV follow", () => {
  let postCount = 0;
  let lastPv: { row: number; col: number }[] = [e0, h1, e2];
  let lastComplete = true;
  const OriginalWorker = globalThis.Worker;

  beforeEach(() => {
    postCount = 0;
    lastPv = [e0, h1, e2];
    lastComplete = true;
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: class FakeWorker {
        onmessage: ((event: MessageEvent<EngineMessage>) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        postMessage(request: EngineRequest): void {
          postCount += 1;
          const id = request.id;
          const pv = lastPv;
          const complete = lastComplete;
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                id,
                ok: true,
                result: {
                  move: pv[0],
                  score: 50,
                  depth: 4,
                  principalVariation: pv,
                  nodesVisited: 10,
                  complete,
                },
              },
            } as MessageEvent<EngineMessage>);
          });
        }
        terminate(): void {}
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: OriginalWorker,
    });
  });

  it("plays the PV reply after a short delay when the human stays on the line", async () => {
    const pool = new EnginePool(1);
    const start = newGame().board;
    const first = await pool.requestMove(start, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    expect(first.move).toEqual(e0);
    const postsAfterSearch = postCount;

    const afterEngine = placeMove(start, e0.row, e0.col, 1);
    const afterHuman = placeMove(afterEngine, h1.row, h1.col, 2);
    const progress: string[] = [];
    jest.useFakeTimers();
    const secondPromise = pool.requestMove(afterHuman, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
      onProgress: ev => progress.push(ev.type),
    });
    expect(progress).toContain("pvFollowHit");
    await jest.advanceTimersByTimeAsync(PV_FOLLOW_DELAY_MS);
    const second = await secondPromise;
    expect(second.move).toEqual(e2);
    expect(second.nodesVisited).toBe(0);
    // Delayed reply: no additional *awaited* search. Background verify may
    // post on the idle slot (postsAfterSearch + 0 or +1).
    expect(postCount).toBeLessThanOrEqual(postsAfterSearch + 1);
    pool.terminate();
  });

  it("searches again when the human leaves the PV", async () => {
    const pool = new EnginePool(1);
    const start = newGame().board;
    await pool.requestMove(start, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    const afterEngine = placeMove(start, e0.row, e0.col, 1);
    const offPv = placeMove(afterEngine, 0, 0, 2);
    await pool.requestMove(offPv, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    expect(postCount).toBe(2);
    pool.terminate();
  });

  it("does not arm in practice mode", async () => {
    const pool = new EnginePool(1);
    const start = newGame().board;
    await pool.requestMove(start, 1, "easy", undefined, {
      experienceMode: "practice",
      persistExperience: false,
    });
    const afterEngine = placeMove(start, e0.row, e0.col, 1);
    const afterHuman = placeMove(afterEngine, h1.row, h1.col, 2);
    await pool.requestMove(afterHuman, 1, "easy", undefined, {
      experienceMode: "practice",
      persistExperience: false,
    });
    expect(postCount).toBe(2);
    pool.terminate();
  });

  it("does not arm when the search result is incomplete", async () => {
    lastComplete = false;
    const pool = new EnginePool(1);
    const start = newGame().board;
    await pool.requestMove(start, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    lastComplete = true;
    const afterEngine = placeMove(start, e0.row, e0.col, 1);
    const afterHuman = placeMove(afterEngine, h1.row, h1.col, 2);
    await pool.requestMove(afterHuman, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    expect(postCount).toBe(2);
    pool.terminate();
  });

  it("does not arm when the PV is shorter than 3", async () => {
    lastPv = [e0, h1];
    const pool = new EnginePool(1);
    const start = newGame().board;
    await pool.requestMove(start, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    lastPv = [e0, h1, e2];
    const afterEngine = placeMove(start, e0.row, e0.col, 1);
    const afterHuman = placeMove(afterEngine, h1.row, h1.col, 2);
    await pool.requestMove(afterHuman, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    expect(postCount).toBe(2);
    pool.terminate();
  });

  it("prefers an experience book hit over PV follow and clears the cursor", async () => {
    const store = new PersistentExperienceStore();
    const pool = new EnginePool(1, store);
    const start = newGame().board;
    await pool.requestMove(start, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });

    const afterEngine = placeMove(start, e0.row, e0.col, 1);
    const afterHuman = placeMove(afterEngine, h1.row, h1.col, 2);
    const bookMove = { row: 0, col: 1 };
    const prepared = prepareExperienceForRequest({
      board: afterHuman,
      player: 1,
      difficulty: "easy",
      experienceMode: "use",
      store,
    });
    store.put("easy", prepared.key, {
      move: prepared.transform.toCanonical(bookMove),
      score: 99,
      depth: 5,
    });

    const second = await pool.requestMove(afterHuman, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    expect(second.move).toEqual(bookMove);
    expect(second.nodesVisited).toBe(0);

    // Cursor was cleared by the experience hit — a later on-line board from
    // the old PV must search, not instant-follow e2.
    const postsBefore = postCount;
    const afterBook = placeMove(afterHuman, bookMove.row, bookMove.col, 1);
    // Opponent plays something; engine to move again — just ensure we still search.
    const afterOpp = placeMove(afterBook, 0, 2, 2);
    await pool.requestMove(afterOpp, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    expect(postCount).toBeGreaterThan(postsBefore);
    pool.terminate();
  });

  it("chains multiple instant replies along the same PV", async () => {
    lastPv = [e0, h1, e2, h3, e4];
    const pool = new EnginePool(1);
    const start = newGame().board;
    await pool.requestMove(start, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });

    let board = placeMove(start, e0.row, e0.col, 1);
    board = placeMove(board, h1.row, h1.col, 2);
    const reply1 = await pool.requestMove(board, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    expect(reply1.move).toEqual(e2);
    expect(reply1.nodesVisited).toBe(0);

    board = placeMove(board, e2.row, e2.col, 1);
    board = placeMove(board, h3.row, h3.col, 2);
    const reply2 = await pool.requestMove(board, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    expect(reply2.move).toEqual(e4);
    expect(reply2.nodesVisited).toBe(0);
    // One foreground search for the opening; follow-ups skip search (+ optional bg).
    expect(postCount).toBeGreaterThanOrEqual(1);
    pool.terminate();
  });

  it("enqueues background verify on a PV hit without rewriting the remaining line", async () => {
    lastPv = [e0, h1, e2, h3, e4];
    const posted: EngineRequest[] = [];
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: class RecordingWorker {
        onmessage: ((event: MessageEvent<EngineMessage>) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        postMessage(request: EngineRequest): void {
          posted.push(request);
          postCount += 1;
          if (request.bookDeepening) {
            return;
          }
          const id = request.id;
          const pv = lastPv;
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                id,
                ok: true,
                result: {
                  move: pv[0],
                  score: 50,
                  depth: 4,
                  principalVariation: pv,
                  nodesVisited: 10,
                  complete: true,
                },
              },
            } as MessageEvent<EngineMessage>);
          });
        }
        terminate(): void {}
      },
    });

    // Two slots: foreground finishes, then PV hit can use the second idle slot
    // for background without preempting.
    const pool = new EnginePool(2);
    const start = newGame().board;
    await pool.requestMove(start, 1, "easy", undefined, {
      experienceMode: "use",
    });

    const afterEngine = placeMove(toPlainBoard(start), e0.row, e0.col, 1);
    const afterHuman = placeMove(afterEngine, h1.row, h1.col, 2);
    const second = await pool.requestMove(afterHuman, 1, "easy", undefined, {
      experienceMode: "use",
    });
    expect(second.move).toEqual(e2);

    const bg = posted.filter(r => r.bookDeepening === true);
    expect(bg.length).toBeGreaterThanOrEqual(1);
    expect(bg[0].experienceBaseline?.move).toEqual(e2);

    // Remaining line still works for the next hop (cursor not replaced by bg).
    let board = placeMove(afterHuman, e2.row, e2.col, 1);
    board = placeMove(board, h3.row, h3.col, 2);
    const third = await pool.requestMove(board, 1, "easy", undefined, {
      experienceMode: "use",
      persistExperience: false,
    });
    expect(third.move).toEqual(e4);
    expect(third.nodesVisited).toBe(0);
    pool.terminate();
  });
});
