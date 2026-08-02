// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { search, prepareRootMoves } from "./search.ts";
import { createEmptyBoard } from "../board.ts";
import { resolveEngineSearchConfig } from "../engine.ts";

describe("search rootCandidates override", () => {
  it("only ever returns a move from the supplied candidate slice", () => {
    const board = createEmptyBoard();
    board[7][7] = 1;
    board[7][8] = 2;
    board[8][7] = 1;
    const base = resolveEngineSearchConfig({ difficulty: "hard" });
    const slice = [
      { row: 6, col: 6 },
      { row: 9, col: 9 },
    ];
    const result = search({ board, player: 2, ...base, rootCandidates: slice });
    expect(slice).toContainEqual(result.move);
  });

  it("actually searches a single-move slice (depth > 0, not pattern-only)", () => {
    const board = createEmptyBoard();
    board[7][7] = 1;
    board[7][8] = 1;
    board[7][9] = 1;
    const base = resolveEngineSearchConfig({ difficulty: "hard" });
    const slice = [{ row: 7, col: 6 }];
    const result = search({ board, player: 2, ...base, rootCandidates: slice });
    expect(result.move).toEqual({ row: 7, col: 6 });
    expect(result.depth).toBeGreaterThan(0);
  });
});

describe("search preparedRoot reuse", () => {
  it("uses the supplied prepared root without re-narrowing to a wider set", () => {
    const board = createEmptyBoard();
    board[7][7] = 1;
    board[7][8] = 2;
    board[8][7] = 1;
    const base = resolveEngineSearchConfig({ difficulty: "hard" });
    const prepared = prepareRootMoves(board, 2, {
      ...base,
      rootCandidates: [{ row: 6, col: 6 }],
    });
    expect(prepared.rootMoves).toEqual([{ row: 6, col: 6 }]);

    const result = search({
      board,
      player: 2,
      ...base,
      maxDepth: 2,
      preparedRoot: prepared,
      // Would widen the root if prepareRootMoves ran again without override.
      rootCandidates: undefined,
    });
    expect(result.move).toEqual({ row: 6, col: 6 });
  });
});
