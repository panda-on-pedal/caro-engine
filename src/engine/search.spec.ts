import { findCandidateMoves } from "./search.ts";
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
