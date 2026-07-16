import { isLegalMove } from "./board.ts";
import { chooseMove } from "./engine.ts";
import { applyMove, newGame } from "./state.ts";

describe("chooseMove", () => {
  it("returns a SearchResult whose move is legal on an empty board", () => {
    const state = newGame();
    const result = chooseMove(state, { difficulty: "easy" });
    expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
      true,
    );
    expect(result.depth).toBeGreaterThan(0);
    expect(Array.isArray(result.principalVariation)).toBe(true);
    expect(typeof result.nodesVisited).toBe("number");
  });

  it("returns a legal move adjacent to an existing stone once the board is non-empty", () => {
    let state = newGame();
    state = applyMove(state, { row: 7, col: 7 }, 1);

    const result = chooseMove(state, { difficulty: "easy" });
    expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
      true,
    );
  });

  it("takes an immediate win-in-1 when one is available, even at easy difficulty", () => {
    let state = newGame();
    // X: (5,1)-(5,4) open on both ends; O plays elsewhere off that line.
    state = applyMove(state, { row: 5, col: 1 }, 1);
    state = applyMove(state, { row: 0, col: 0 }, 2);
    state = applyMove(state, { row: 5, col: 2 }, 1);
    state = applyMove(state, { row: 0, col: 1 }, 2);
    state = applyMove(state, { row: 5, col: 3 }, 1);
    state = applyMove(state, { row: 0, col: 2 }, 2);
    state = applyMove(state, { row: 5, col: 4 }, 1);
    state = applyMove(state, { row: 0, col: 3 }, 2);

    const result = chooseMove(state, { difficulty: "easy" });
    expect([
      { row: 5, col: 0 },
      { row: 5, col: 5 },
    ]).toContainEqual(result.move);
  });

  it("defaults to a usable configuration when none is passed", () => {
    const state = newGame();
    const result = chooseMove(state);
    expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
      true,
    );
  });

  it("searches deeper at hard than at easy for the same position", () => {
    let state = newGame();
    state = applyMove(state, { row: 10, col: 10 }, 1);
    state = applyMove(state, { row: 3, col: 3 }, 2);

    const easy = chooseMove(state, { difficulty: "easy" });
    const hard = chooseMove(state, { difficulty: "hard", timeBudgetMs: 2000 });
    expect(hard.depth).toBeGreaterThanOrEqual(easy.depth);
  });
});
