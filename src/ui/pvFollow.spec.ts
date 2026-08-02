// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { createEmptyBoard, placeMove } from "../engine/board.ts";
import type { SearchResult } from "../engine/search/search.ts";
import { boardsEqual, tryArmPvFollow, tryConsumePvFollow } from "./pvFollow.ts";

const e0 = { row: 7, col: 7 };
const h1 = { row: 7, col: 8 };
const e2 = { row: 8, col: 8 };
const h3 = { row: 8, col: 9 };
const e4 = { row: 9, col: 9 };

function completeResult(pv: { row: number; col: number }[]): SearchResult {
  return {
    move: pv[0],
    score: 120,
    depth: 4,
    principalVariation: pv,
    nodesVisited: 99,
    complete: true,
  };
}

describe("boardsEqual", () => {
  it("compares cell-by-cell", () => {
    const a = createEmptyBoard();
    const b = createEmptyBoard();
    expect(boardsEqual(a, b)).toBe(true);
    b[0][0] = 1;
    expect(boardsEqual(a, b)).toBe(false);
  });
});

describe("tryArmPvFollow", () => {
  const board = createEmptyBoard();

  it("arms when use + complete + deep + PV length >= 3", () => {
    const state = tryArmPvFollow({
      experienceMode: "use",
      difficulty: "easy",
      requestBoard: board,
      enginePlayer: 1,
      result: completeResult([e0, h1, e2, h3, e4]),
    });
    expect(state).not.toBeNull();
    expect(state!.remaining).toEqual([h1, e2, h3, e4]);
    expect(state!.playerToMove).toBe(1);
    const postEngine = placeMove(board, e0.row, e0.col, 1);
    const expected = placeMove(postEngine, h1.row, h1.col, 2);
    expect(boardsEqual(state!.expectedBoard, expected)).toBe(true);
  });

  it("returns null for practice / off / incomplete / short PV", () => {
    const base = {
      difficulty: "easy" as const,
      requestBoard: board,
      enginePlayer: 1 as const,
      result: completeResult([e0, h1, e2]),
    };
    expect(tryArmPvFollow({ ...base, experienceMode: "practice" })).toBeNull();
    expect(tryArmPvFollow({ ...base, experienceMode: "off" })).toBeNull();
    expect(
      tryArmPvFollow({
        ...base,
        experienceMode: "use",
        result: { ...completeResult([e0, h1, e2]), complete: false },
      })
    ).toBeNull();
    expect(
      tryArmPvFollow({
        ...base,
        experienceMode: "use",
        result: completeResult([e0, h1]),
      })
    ).toBeNull();
  });
});

describe("tryConsumePvFollow", () => {
  it("returns next engine move and re-arms the tail", () => {
    const board = createEmptyBoard();
    const armed = tryArmPvFollow({
      experienceMode: "use",
      difficulty: "hard",
      requestBoard: board,
      enginePlayer: 1,
      result: completeResult([e0, h1, e2, h3, e4]),
    })!;
    const hit = tryConsumePvFollow({
      state: armed,
      experienceMode: "use",
      difficulty: "hard",
      board: armed.expectedBoard,
      player: 1,
    });
    expect(hit).not.toBeNull();
    expect(hit!.hit.move).toEqual(e2);
    expect(hit!.hit.nodesVisited).toBe(0);
    expect(hit!.hit.principalVariation).toEqual([e2, h3, e4]);
    expect(hit!.next).not.toBeNull();
    expect(hit!.next!.remaining).toEqual([h3, e4]);
  });

  it("returns null and does not invent a hit when board mismatches", () => {
    const board = createEmptyBoard();
    const armed = tryArmPvFollow({
      experienceMode: "use",
      difficulty: "easy",
      requestBoard: board,
      enginePlayer: 1,
      result: completeResult([e0, h1, e2]),
    })!;
    const miss = tryConsumePvFollow({
      state: armed,
      experienceMode: "use",
      difficulty: "easy",
      board: board,
      player: 1,
    });
    expect(miss).toBeNull();
  });
});
