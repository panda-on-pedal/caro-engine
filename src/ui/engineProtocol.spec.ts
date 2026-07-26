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
  it("returns a use-mode hit as instant AND baseline, with the permanent flag", () => {
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
    expect(miss.permanent).toBe(false);

    // Store in the canonical frame, exactly as EnginePool.applyResult does.
    store.put("easy", miss.key, {
      move: miss.transform.toCanonical({ row: 4, col: 4 }),
      score: 10,
      depth: 3,
    });

    const hit = prepareExperienceForRequest(params);
    expect(hit.instant?.move).toEqual({ row: 4, col: 4 });
    expect(hit.baseline?.move).toEqual({ row: 4, col: 4 });
    expect(hit.baseline?.depth).toBe(3);
    expect(hit.permanent).toBe(false);

    store.setStallCount("easy", miss.key, 3);
    const permanentHit = prepareExperienceForRequest(params);
    expect(permanentHit.instant?.move).toEqual({ row: 4, col: 4 });
    expect(permanentHit.permanent).toBe(true);
  });

  it("replays a human-book hit ahead of the difficulty book, without a baseline", () => {
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

    // Difficulty book says (4,4); human book says (3,3) — human must win.
    store.put("easy", miss.key, {
      move: miss.transform.toCanonical({ row: 4, col: 4 }),
      score: 10,
      depth: 3,
    });
    store.putHuman(miss.key, {
      move: miss.transform.toCanonical({ row: 3, col: 3 }),
      score: 0,
      depth: 1,
    });

    const hit = prepareExperienceForRequest(params);
    expect(hit.instant?.move).toEqual({ row: 3, col: 3 });
    expect(hit.baseline).toBeUndefined(); // no search seed → no background improvement
    expect(hit.permanent).toBe(true);
  });

  it("tags a practice-mode human-book hit as a cache hit", () => {
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
    store.putHuman(miss.key, {
      move: miss.transform.toCanonical({ row: 3, col: 3 }),
      score: 0,
      depth: 1,
    });

    const hit = prepareExperienceForRequest(params);
    expect(hit.instant?.move).toEqual({ row: 3, col: 3 });
    expect(hit.instant?.experienceCacheHit).toBe(true);
    expect(hit.instant?.experienceStreakEligible).toBe(true);
  });

  it("ignores the human book in off mode", () => {
    const store = new PersistentExperienceStore();
    let state = newGame();
    state = applyMove(state, { row: 5, col: 5 }, 1);
    state = applyMove(state, { row: 5, col: 6 }, 2);
    const base = {
      board: state.board,
      player: state.nextPlayer,
      difficulty: "easy" as const,
      store,
    };
    const miss = prepareExperienceForRequest({ ...base, experienceMode: "use" });
    store.putHuman(miss.key, {
      move: miss.transform.toCanonical({ row: 3, col: 3 }),
      score: 0,
      depth: 1,
    });

    const off = prepareExperienceForRequest({ ...base, experienceMode: "off" });
    expect(off.instant).toBeNull();
  });

  it("practice mode only instant-replays permanent entries", () => {
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

    const nonPermanent = prepareExperienceForRequest(params);
    expect(nonPermanent.instant).toBeNull();
    expect(nonPermanent.baseline?.move).toEqual({ row: 4, col: 4 });
    expect(nonPermanent.permanent).toBe(false);

    store.setStallCount("easy", miss.key, 3);
    const permanent = prepareExperienceForRequest(params);
    expect(permanent.instant?.move).toEqual({ row: 4, col: 4 });
    expect(permanent.instant?.experienceCacheHit).toBe(true);
    expect(permanent.permanent).toBe(true);
  });

  it("instant-replays non-permanent practice hits when improvement is off", () => {
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

    // Default (improvement on): non-permanent hit still forces a foreground search.
    expect(prepareExperienceForRequest(params).instant).toBeNull();

    // Improvement off: the non-permanent hit replays instantly instead.
    const offParams = { ...params, practiceImprovement: false };
    const instant = prepareExperienceForRequest(offParams);
    expect(instant.instant?.move).toEqual({ row: 4, col: 4 });
    expect(instant.instant?.experienceCacheHit).toBe(true);
    expect(instant.permanent).toBe(false);
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
      timeBudgetMs: 500,
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
