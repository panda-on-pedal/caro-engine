// src/engine/rankMoves.spec.ts
import { createEmptyBoard, placeMove } from "./board.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";
import {
  scoreMove,
  selectTopMoves,
  selectTopMovesFromStore,
  selectTopMovesTiered,
  totalPatternScore,
} from "./rankMoves.ts";
import { findPatterns } from "./patterns.ts";
import { PatternStore } from "./patternStore.ts";

/** O: (8,10), (10,11), (12,9). X: 2x2 block (9,8)/(9,9)/(10,8)/(10,9).
 * Matches docs/superpowers/plans/2026-07-18-board-state-catalog.md #5.1 —
 * (11,10) sits on O's anti-diagonal (10,11)-(12,9) *and* blocks X's
 * diagonal (9,8)-(10,9) from extending; (10,6) only pre-blocks a distant
 * future extension of X's row-10 pair. */
function dualPurposeFixtureBoard() {
  let board = createEmptyBoard(20);
  board = placeMove(board, 8, 10, 2);
  board = placeMove(board, 9, 8, 1);
  board = placeMove(board, 9, 9, 1);
  board = placeMove(board, 10, 8, 1);
  board = placeMove(board, 10, 9, 1);
  board = placeMove(board, 10, 11, 2);
  board = placeMove(board, 12, 9, 2);
  return board;
}

describe("totalPatternScore", () => {
  it("sums PATTERN_SCORES over the given instances", () => {
    const board = parseBoard("..OO...");
    const patterns = findPatterns(board, 2);
    expect(totalPatternScore(patterns)).toBe(
      patterns.reduce((sum, p) => sum + totalPatternScore([p]), 0),
    );
    expect(totalPatternScore([])).toBe(0);
  });
});

describe("scoreMove", () => {
  it("scores higher when a move both expands an own line and blocks the opponent", () => {
    const board = dualPurposeFixtureBoard();
    const dual = scoreMove(board, 2, { row: 11, col: 10 });
    const weak = scoreMove(board, 2, { row: 10, col: 6 });
    expect(dual).toBeGreaterThan(weak);
  });

  it("returns +Infinity when the move wins immediately", () => {
    const board = parseBoard("XXXX.");
    expect(scoreMove(board, 1, { row: 0, col: 4 })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("scores a quiet, disconnected cell as zero", () => {
    const board = parseBoard(`
      ..........
      ..X.......
      ..........
    `);
    expect(scoreMove(board, 1, { row: 2, col: 9 })).toBe(0);
  });
});

describe("selectTopMovesFromStore", () => {
  it("agrees with selectTopMoves and leaves the store depth unchanged", () => {
    const board = dualPurposeFixtureBoard();
    const moves = [
      { row: 11, col: 10 },
      { row: 10, col: 6 },
      { row: 9, col: 10 },
      { row: 11, col: 9 },
      { row: 8, col: 9 },
      { row: 12, col: 10 },
    ];
    const store = PatternStore.fromBoard(board);
    const fromStore = selectTopMovesFromStore(store, 2, moves, 5);
    const fromBoard = selectTopMoves(board, 2, moves, 5);
    expect(fromStore.map((m) => `${m.row},${m.col}`)).toEqual(
      fromBoard.map((m) => `${m.row},${m.col}`),
    );
    expect(store.depth).toBe(0);
  });
});

describe("selectTopMoves", () => {
  it("returns at most k moves, highest scores first", () => {
    const board = parseBoard("..XX...");
    const moves = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 4 },
      { row: 0, col: 5 },
      { row: 0, col: 6 },
      { row: 1, col: 2 },
    ];
    const top = selectTopMoves(board, 1, moves, 3);
    expect(top).toHaveLength(3);
    const scores = top.map((m) => scoreMove(board, 1, m));
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
    expect(scores[1]).toBeGreaterThanOrEqual(scores[2]);
  });

  it("preserves relative order for equal scores (stable)", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    // Far empty cells with identical zero deltas keep input order.
    const moves = [
      { row: 0, col: 0 },
      { row: 0, col: 4 },
      { row: 4, col: 0 },
    ];
    const top = selectTopMoves(board, 2, moves, 3);
    expect(top.map((m) => `${m.row},${m.col}`)).toEqual([
      "0,0",
      "0,4",
      "4,0",
    ]);
  });

  it("prefers the dual-purpose move over a weak one-sided block when both compete for a slot", () => {
    const board = dualPurposeFixtureBoard();
    const moves = [
      { row: 11, col: 10 },
      { row: 10, col: 6 },
    ];
    const top = selectTopMoves(board, 2, moves, 1);
    expect(top).toEqual([{ row: 11, col: 10 }]);
  });

  it("returns an immediate win first regardless of input order", () => {
    const board = parseBoard("XXXX.......");
    const moves = [
      { row: 0, col: 9 },
      { row: 0, col: 4 },
    ];
    const top = selectTopMoves(board, 1, moves, 5);
    expect(top[0]).toEqual({ row: 0, col: 4 });
  });
});

describe("selectTopMovesTiered", () => {
  // Extending X's "..XX..." pair scores high; far empty cells score 0.
  const board = () => parseBoard("..XX.......");
  const extend = { row: 0, col: 4 }; // high score: grows the pair
  const extendFar = { row: 0, col: 1 }; // high score: grows the pair
  const quietA = { row: 0, col: 8 }; // score 0
  const quietB = { row: 0, col: 9 }; // score 0

  it("keeps every earlier-tier move ahead of later tiers even when later scores are higher", () => {
    const top = selectTopMovesTiered(
      board(),
      1,
      [
        [quietA, quietB],
        [extend, extendFar],
      ],
      4,
    );
    expect(top.slice(0, 2)).toEqual([quietA, quietB]);
    expect(top.slice(2)).toHaveLength(2);
  });

  it("sorts within each tier by score descending, stable on ties", () => {
    const top = selectTopMovesTiered(
      board(),
      1,
      [[quietA, extend, quietB]],
      3,
    );
    expect(top[0]).toEqual(extend);
    expect(top.slice(1)).toEqual([quietA, quietB]);
  });

  it("drops duplicates across tiers, keeping the earlier tier's slot", () => {
    const top = selectTopMovesTiered(
      board(),
      1,
      [
        [quietA],
        [quietA, extend],
      ],
      5,
    );
    expect(top).toEqual([quietA, extend]);
  });

  it("caps the combined result at k without evicting earlier-tier moves", () => {
    const top = selectTopMovesTiered(
      board(),
      1,
      [
        [quietA, quietB],
        [extend, extendFar, { row: 0, col: 6 }, { row: 0, col: 7 }],
      ],
      3,
    );
    expect(top).toHaveLength(3);
    expect(top.slice(0, 2)).toEqual([quietA, quietB]);
  });
});
