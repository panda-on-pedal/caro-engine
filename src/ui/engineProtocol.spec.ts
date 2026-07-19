import { isLegalMove } from "../engine/board.ts";
import { applyMove, newGame } from "../engine/state.ts";
import { handleEngineRequest } from "./engineProtocol.ts";

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
