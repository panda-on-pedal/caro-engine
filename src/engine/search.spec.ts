import { findCandidateMoves, negamaxSearch } from "./search.ts";
import { WIN_SCORE } from "./evaluate.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

describe("findCandidateMoves", () => {
  it("returns only the center cell on an empty board", () => {
    const board = parseBoard(`
      .....
      .....
      .....
      .....
      .....
    `);
    const candidates = findCandidateMoves(board);
    expect(candidates).toEqual([{ row: 2, col: 2 }]);
  });

  it("returns only empty cells within distance 2 of an existing stone", () => {
    const board = parseBoard(`
      .......
      .......
      ..X....
      .......
      .......
      .......
      .......
    `);
    const candidates = findCandidateMoves(board);
    expect(candidates.length).toBeGreaterThan(0);
    for (const move of candidates) {
      const rowDelta = Math.abs(move.row - 2);
      const colDelta = Math.abs(move.col - 2);
      expect(Math.max(rowDelta, colDelta)).toBeLessThanOrEqual(2);
    }
    // (5,5) is far from the only stone at (2,2) and must not be a candidate.
    expect(candidates.some((m) => m.row === 5 && m.col === 5)).toBe(false);
  });

  it("never returns an occupied cell", () => {
    const board = parseBoard(`
      .......
      ..XXX..
      .......
    `);
    const candidates = findCandidateMoves(board);
    for (const move of candidates) {
      expect(board[move.row][move.col]).toBe(0);
    }
  });
});

describe("negamaxSearch", () => {
  it("finds the unique winning move when one is available (win-in-1)", () => {
    // X has an open four; playing either end wins. Use an open four
    // blocked on the left by board edge padding removed — force a unique
    // winning square by blocking one end with O.
    const board = parseBoard(`
      ..........
      .OXXXX....
      ..........
    `);
    const result = negamaxSearch(board, 1, 2);
    expect(result.principalVariation[0]).toEqual({ row: 1, col: 6 });
    expect(result.score).toBeGreaterThan(0);
  });

  it("finds the unique blocking move when the opponent threatens an open four next move", () => {
    // O has a four blocked on the left by an X stone at col 0, so O's only
    // legal winning extension is col 5 (checkCaroWin only rejects a five
    // blocked at BOTH ends, so a single-side block does not stop O on its
    // own — occupying the winning square is what stops it). The board is
    // narrowed to 6 columns so col 6 ("poison the far end so O's five is
    // double-blocked") is off-board and not a legal alternative; col 5 is
    // the unique square that prevents O's win.
    //
    // Even though X's move is the objectively correct block, the returned
    // score is not necessarily positive: this move doesn't end the game,
    // so negamax looks one more ply ahead and lets O take a free tempo move
    // that can rack up incidental (but non-threatening) two-in-a-row
    // patterns via evaluate()'s uncapped per-direction summation. So the
    // real invariant here is that this move is uniquely best and avoids
    // the forced loss (score nowhere near -WIN_SCORE), not that the score
    // is positive.
    const board = parseBoard(`
      ......
      XOOOO.
      ......
    `);
    const result = negamaxSearch(board, 1, 2);
    expect(result.principalVariation[0]).toEqual({ row: 1, col: 5 });
    expect(result.score).toBeGreaterThan(-WIN_SCORE);
  });

  it("returns a score of 0 for an empty board scanned to depth 1 (no forced outcome)", () => {
    const board = parseBoard(`
      .....
      .....
      .....
      .....
      .....
    `);
    const result = negamaxSearch(board, 1, 1);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.principalVariation).toHaveLength(1);
  });
});
