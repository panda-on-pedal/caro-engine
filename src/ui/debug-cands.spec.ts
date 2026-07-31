import { applyMove, newGame } from "../engine/state.ts";
import { prepareRootMoves } from "../engine/search/search.ts";
import { resolveEngineSearchConfig } from "../engine/engine.ts";

describe("debug", () => {
  it("cands", () => {
    let state = newGame();
    state = applyMove(state, { row: 5, col: 5 }, 1);
    state = applyMove(state, { row: 5, col: 6 }, 2);
    for (const d of ["easy", "hard"] as const) {
      const { narrowed, rootMoves } = prepareRootMoves(state.board, state.nextPlayer, {
        ...resolveEngineSearchConfig({ difficulty: d }),
        experienceMode: "off",
      });
      console.log(d, narrowed.source, rootMoves.map(m => `${m.row},${m.col}`));
    }
  });
});
