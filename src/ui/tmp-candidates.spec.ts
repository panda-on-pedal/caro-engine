import { applyMove, newGame } from "../engine/state.ts";
import { prepareRootMoves } from "../engine/search/search.ts";
import { resolveEngineSearchConfig } from "../engine/engine.ts";

describe("tmp", () => {
  it("lists easy candidates", () => {
    let state = newGame();
    state = applyMove(state, { row: 5, col: 5 }, 1);
    state = applyMove(state, { row: 5, col: 6 }, 2);
    const { narrowed, rootMoves } = prepareRootMoves(state.board, state.nextPlayer, {
      ...resolveEngineSearchConfig({ difficulty: "easy" }),
      experienceMode: "off",
    });
    console.log(narrowed.source, rootMoves.map(m => `${m.row},${m.col}`));
    expect(rootMoves.some(m => m.row === 4 && m.col === 4)).toBe(true);
  });
});
