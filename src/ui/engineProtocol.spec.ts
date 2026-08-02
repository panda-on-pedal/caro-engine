// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { isLegalMove } from "../engine/board.ts";
import { createEmptyBoard } from "../engine/board.ts";
import { applyMove, newGame } from "../engine/state.ts";
import {
  handleEngineRequest,
  prepareExperienceForRequest,
  resetStoreCache,
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

describe("handleEngineRequest pattern store cache", () => {
  // The worker keeps one store across requests, so a request must never be
  // searched against the previous request's position — the returned move
  // would be illegal (or land on an occupied cell) on the board it was asked
  // about. Covers forward sync, an unrelated board, and a backwards jump.
  it("stays consistent with the requested board across sequential requests", () => {
    resetStoreCache();
    let state = newGame();
    state = applyMove(state, { row: 10, col: 10 }, 1);
    state = applyMove(state, { row: 9, col: 10 }, 2);
    const opening = state.board;

    state = applyMove(state, { row: 10, col: 11 }, 1);
    state = applyMove(state, { row: 9, col: 11 }, 2);
    const advanced = state.board;

    const elsewhere = createEmptyBoard(20);
    elsewhere[3][3] = 1;
    elsewhere[4][4] = 2;
    elsewhere[3][4] = 1;

    for (const board of [opening, advanced, elsewhere, opening, advanced]) {
      const response = handleEngineRequest({
        id: 7,
        board,
        player: 1,
        difficulty: "easy",
      });
      expect(response.ok).toBe(true);
      if (response.ok) {
        const { row, col } = response.result.move;
        expect(isLegalMove(board, row, col)).toBe(true);
      }
    }
  });

  it("matches a cold worker on a forced block", () => {
    // A single-candidate (forced) root is jitter-proof, so the warm-cache
    // answer must equal the cold one exactly.
    const board = createEmptyBoard(20);
    for (const col of [6, 7, 8, 9]) {
      board[10][col] = 2;
    }
    const warmup = createEmptyBoard(20);
    warmup[10][6] = 2;

    resetStoreCache();
    const cold = handleEngineRequest({ id: 1, board, player: 1, difficulty: "medium" });

    resetStoreCache();
    handleEngineRequest({ id: 2, board: warmup, player: 1, difficulty: "medium" });
    const warm = handleEngineRequest({ id: 3, board, player: 1, difficulty: "medium" });

    expect(cold.ok && warm.ok).toBe(true);
    if (cold.ok && warm.ok) {
      expect(warm.result.move).toEqual(cold.result.move);
    }
  });
});

describe("prepareExperienceForRequest", () => {
  it("does not book or replay the single-stone opening reply", () => {
    // Regression: canonical keys used to collapse every mid-board lone stone
    // onto one entry, so a stored NW reply locked all first-move answers.
    const store = new PersistentExperienceStore();
    let state = newGame();
    state = applyMove(state, { row: 10, col: 10 }, 1);
    const prepared = prepareExperienceForRequest({
      board: state.board,
      player: 2,
      difficulty: "medium",
      experienceMode: "use",
      store,
    });
    expect(prepared.key).toBe("EMPTY");
    expect(prepared.instant).toBeNull();
    expect(prepared.baseline).toBeUndefined();

    store.put("medium", "EMPTY", {
      move: { row: 9, col: 9 },
      score: 10,
      depth: 4,
      stallCount: 3,
    });
    const again = prepareExperienceForRequest({
      board: state.board,
      player: 2,
      difficulty: "medium",
      experienceMode: "use",
      store,
    });
    expect(again.instant).toBeNull();
    expect(again.baseline).toBeUndefined();
  });

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

  it("discards a difficulty-book key whose move is outside today's rootMoves", () => {
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
    store.put("easy", miss.key, {
      move: miss.transform.toCanonical({ row: 4, col: 4 }),
      score: 10,
      depth: 4,
      stallCount: 3,
    });
    expect(store.get("easy", miss.key)).toBeDefined();

    const stale = prepareExperienceForRequest({
      ...params,
      // Candidates that do not include the booked 4,4.
      rootMoves: [
        { row: 6, col: 6 },
        { row: 6, col: 5 },
      ],
      rootSource: "tactical",
    });
    expect(stale.instant).toBeNull();
    expect(stale.baseline).toBeUndefined();
    expect(stale.staleDiscarded).toBe(true);
    expect(store.get("easy", miss.key)).toBeUndefined();
  });

  it("keeps a book hit when the move is in rootMoves", () => {
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
    store.put("easy", miss.key, {
      move: miss.transform.toCanonical({ row: 4, col: 4 }),
      score: 10,
      depth: 4,
    });

    const hit = prepareExperienceForRequest({
      ...params,
      rootMoves: [
        { row: 4, col: 4 },
        { row: 6, col: 6 },
      ],
      rootSource: "tactical",
    });
    expect(hit.instant?.move).toEqual({ row: 4, col: 4 });
    expect(hit.staleDiscarded).toBeUndefined();
    expect(store.get("easy", miss.key)).toBeDefined();
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
