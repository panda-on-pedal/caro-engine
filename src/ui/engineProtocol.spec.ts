import { isLegalMove } from "../engine/board.ts";
import { applyMove, newGame } from "../engine/state.ts";
import {
  handleEngineRequest,
  prepareExperienceForRequest,
} from "./engineProtocol.ts";
import { PersistentExperienceStore } from "./experiencePersist.ts";

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
      expect(isLegalMove(state.board, response.result.move.row, response.result.move.col)).toBe(true);
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
      expect(isLegalMove(state.board, response.result.move.row, response.result.move.col)).toBe(true);
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
    store.put('easy', miss.key, {
      move: miss.transform.toCanonical({ row: 4, col: 4 }),
      score: 10,
      depth: 3,
    });

    const hit = prepareExperienceForRequest(params);
    expect(hit.instant?.move).toEqual({ row: 4, col: 4 });
    expect(hit.baseline?.move).toEqual({ row: 4, col: 4 });
    expect(hit.baseline?.depth).toBe(3);
    expect(hit.settled).toBe(false);

    store.markSettled('easy', miss.key);
    const settledHit = prepareExperienceForRequest(params);
    expect(settledHit.instant?.move).toEqual({ row: 4, col: 4 });
    expect(settledHit.settled).toBe(true);
  });
});
