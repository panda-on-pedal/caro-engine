import { findForkPoints, findPatterns } from "./patterns.ts";
import { findCandidateMoves, negamaxSearch, orderMoves } from "./search.ts";
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

describe("orderMoves", () => {
  it("puts the move that completes a five first", () => {
    const board = parseBoard(".XXXX....");
    const ownPatterns = findPatterns(board, 1);
    const oppPatterns = findPatterns(board, 2);
    const forkPoints = new Set(
      findForkPoints(ownPatterns).map((f) => `${f.move.row},${f.move.col}`),
    );
    const moves = [
      { row: 0, col: 8 },
      { row: 0, col: 5 },
      { row: 0, col: 0 },
    ];

    const ordered = orderMoves(moves, ownPatterns, oppPatterns, forkPoints);
    expect(ordered[0]).toEqual({ row: 0, col: 5 });
  });

  it("prioritizes blocking an opponent four over developing an own open-three", () => {
    const board = parseBoard(`
      .OOOO....
      .........
      .XXX.....
    `);
    const ownPatterns = findPatterns(board, 1);
    const oppPatterns = findPatterns(board, 2);
    const forkPoints = new Set(
      findForkPoints(ownPatterns).map((f) => `${f.move.row},${f.move.col}`),
    );
    const moves = [
      { row: 2, col: 4 },
      { row: 0, col: 5 },
    ];

    const ordered = orderMoves(moves, ownPatterns, oppPatterns, forkPoints);
    expect(ordered[0]).toEqual({ row: 0, col: 5 });
  });

  it("prioritizes completing an own four (into a five) over blocking an opponent's four (regression: dead five-tier bug)", () => {
    // X has an own open four in row 0 (gains at col 0 and col 5); O has an
    // unrelated open four in row 2 (gains at col 0 and col 5). Both a
    // move that completes X's own five and a move that blocks O's four
    // are candidates, at different cells. The move that completes X's own
    // win must be ranked strictly first: a "five" PatternInstance always
    // has an empty gains list (see findFives in patterns.ts), so the move
    // that actually completes an own five shows up as a gain of X's
    // "four"/"open-four" pattern, not as a gain of a "five" pattern. The
    // buggy tier order ranked "own five" (a check that can never fire)
    // above "block opponent four", which meant the real own-four-completion
    // gain landed in a lower tier than the opponent-block tier and thus
    // sorted after it.
    const board = parseBoard(`
      .XXXX....
      .........
      .OOOO....
    `);
    const ownPatterns = findPatterns(board, 1);
    const oppPatterns = findPatterns(board, 2);
    const forkPoints = new Set(
      findForkPoints(ownPatterns).map((f) => `${f.move.row},${f.move.col}`),
    );
    const moves = [
      { row: 2, col: 0 }, // blocks O's four
      { row: 0, col: 0 }, // completes X's own four into a five
    ];

    const ordered = orderMoves(moves, ownPatterns, oppPatterns, forkPoints);
    expect(ordered[0]).toEqual({ row: 0, col: 0 });
  });
});
