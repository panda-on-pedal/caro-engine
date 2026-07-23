import { isLegalMove } from "../engine/board.ts";
import { createEmptyBoard } from "../engine/board.ts";
import { applyMove, newGame } from "../engine/state.ts";
import {
  handleEngineRequest,
  prepareExperienceForRequest,
  runBookDeepening,
  type EngineRequest,
} from "./engineProtocol.ts";
import { PersistentExperienceStore } from "./experiencePersist.ts";
import { type TTEntry } from "../engine/transposition/transposition.ts";

describe("handleEngineRequest", () => {
  it("returns a legal move and echoes the request id on a mid-game board", () => {
    let state = newGame();
    state = applyMove(state, { row: 10, col: 10 }, 1);
    state = applyMove(state, { row: 0, col: 0 }, 2);

    const response = handleEngineRequest({
      id: 42,
      board: state.board,
      player: state.nextPlayer,
      difficulty: "easy",
    });

    expect(response.id).toBe(42);
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(isLegalMove(state.board, response.result.move.row, response.result.move.col)).toBe(
        true
      );
    }
  });

  it("respects a tiny timeBudgetMs override and still returns a move", () => {
    const state = newGame();

    const response = handleEngineRequest({
      id: 1,
      board: state.board,
      player: state.nextPlayer,
      difficulty: "hard",
      timeBudgetMs: 1,
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(isLegalMove(state.board, response.result.move.row, response.result.move.col)).toBe(
        true
      );
    }
  });
});

describe("prepareExperienceForRequest", () => {
  it("returns a use-mode hit as instant AND baseline, with the settled flag", () => {
    const store = new PersistentExperienceStore();
    let state = newGame();
    state = applyMove(state, { row: 5, col: 5 }, 1);
    state = applyMove(state, { row: 5, col: 6 }, 2);
    const params = {
      board: state.board,
      player: state.nextPlayer,
      difficulty: "easy" as const,
      experienceMode: "use" as const,
      store,
    };

    const miss = prepareExperienceForRequest(params);
    expect(miss.instant).toBeNull();
    expect(miss.baseline).toBeUndefined();
    expect(miss.settled).toBe(false);

    // Store in the canonical frame, exactly as EnginePool.rememberResult does.
    store.put("easy", miss.key, {
      move: miss.transform.toCanonical({ row: 4, col: 4 }),
      score: 10,
      depth: 3,
    });

    const hit = prepareExperienceForRequest(params);
    expect(hit.instant?.move).toEqual({ row: 4, col: 4 });
    expect(hit.baseline?.move).toEqual({ row: 4, col: 4 });
    expect(hit.baseline?.depth).toBe(3);
    expect(hit.settled).toBe(false);

    store.markSettled("easy", miss.key);
    const settledHit = prepareExperienceForRequest(params);
    expect(settledHit.instant?.move).toEqual({ row: 4, col: 4 });
    expect(settledHit.settled).toBe(true);
  });

  it("practice mode only instant-replays settled entries", () => {
    const store = new PersistentExperienceStore();
    let state = newGame();
    state = applyMove(state, { row: 5, col: 5 }, 1);
    state = applyMove(state, { row: 5, col: 6 }, 2);
    const params = {
      board: state.board,
      player: state.nextPlayer,
      difficulty: "easy" as const,
      experienceMode: "practice" as const,
      store,
    };

    const miss = prepareExperienceForRequest(params);
    store.put("easy", miss.key, {
      move: miss.transform.toCanonical({ row: 4, col: 4 }),
      score: 10,
      depth: 3,
    });

    const unsettled = prepareExperienceForRequest(params);
    expect(unsettled.instant).toBeNull();
    expect(unsettled.baseline?.move).toEqual({ row: 4, col: 4 });
    expect(unsettled.settled).toBe(false);

    store.markSettled("easy", miss.key);
    const settled = prepareExperienceForRequest(params);
    expect(settled.instant?.move).toEqual({ row: 4, col: 4 });
    expect(settled.instant?.experienceCacheHit).toBe(true);
    expect(settled.settled).toBe(true);
  });
});

describe("runBookDeepening", () => {
  it("seeds from loadSlice, flushes per completed depth, and returns a move", async () => {
    const board = createEmptyBoard();
    board[5][5] = 1;
    board[5][6] = 1;
    board[6][6] = 2;

    const flushed: Array<[string, number]> = [];
    const request: EngineRequest = {
      id: 1,
      board,
      player: 1,
      difficulty: "medium",
      // Cap the real search so the test is fast despite BOOK_MAX_DEPTH=24.
      timeBudgetMs: 50,
      bookDeepening: true,
      canonicalKey: "KEY_X",
    };

    const response = await runBookDeepening(request, {
      loadSlice: (key: string) => {
        expect(key).toBe("KEY_X");
        return Promise.resolve([]);
      },
      flushSlice: (key: string, dirty: Array<[bigint, TTEntry]>) => {
        flushed.push([key, dirty.length]);
        return Promise.resolve();
      },
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.move).toBeDefined();
    }
    expect(flushed.length).toBeGreaterThan(0);
    expect(flushed.every(([k]) => k === "KEY_X")).toBe(true);
  });
});
