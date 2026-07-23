import { createEmptyBoard, placeMove, type Player } from "../board.ts";
import { findCandidateMoves } from "../search/narrow.ts";
import { findPatterns, type PatternInstance } from "./patterns.ts";
import { PatternStore } from "./patternStore.ts";
import { parseBoard } from "../test-helpers/parse-board.ts";

function canonicalize(patterns: readonly PatternInstance[]) {
  return patterns
    .map((p) => ({
      type: p.type,
      dir: `${p.direction[0]},${p.direction[1]}`,
      cells: p.cells.map((c) => `${c.row},${c.col}`).sort().join("|"),
      gains: p.gains.map((c) => `${c.row},${c.col}`).sort().join("|"),
      critical: p.criticalGains
        .map((c) => `${c.row},${c.col}`)
        .sort()
        .join("|"),
    }))
    .sort((a, b) =>
      `${a.type}|${a.dir}|${a.cells}`.localeCompare(
        `${b.type}|${b.dir}|${b.cells}`,
      ),
    );
}

function expectStoreMatchesBoard(store: PatternStore): void {
  expect(canonicalize(store.patterns(1))).toEqual(
    canonicalize(findPatterns(store.board, 1)),
  );
  expect(canonicalize(store.patterns(2))).toEqual(
    canonicalize(findPatterns(store.board, 2)),
  );
}

describe("PatternStore", () => {
  it("fromBoard matches findPatterns for both players", () => {
    const board = parseBoard(`
      .....
      .XX..
      ..O..
      .....
    `);
    const store = PatternStore.fromBoard(board);
    expect(canonicalize(store.patterns(1))).toEqual(
      canonicalize(findPatterns(board, 1)),
    );
    expect(canonicalize(store.patterns(2))).toEqual(
      canonicalize(findPatterns(board, 2)),
    );
  });

  it("place then patterns match findPatterns on the placed board", () => {
    const board = parseBoard(`
      .....
      .XX..
      ..O..
      .....
    `);
    const store = PatternStore.fromBoard(board);
    store.place({ row: 1, col: 3 }, 1);
    const expected = placeMove(board, 1, 3, 1);
    expect(canonicalize(store.patterns(1))).toEqual(
      canonicalize(findPatterns(expected, 1)),
    );
    expect(canonicalize(store.patterns(2))).toEqual(
      canonicalize(findPatterns(expected, 2)),
    );
  });

  it("undo restores prior patterns and empty cell", () => {
    const board = parseBoard(`
      .....
      .XX..
      ..O..
      .....
    `);
    const store = PatternStore.fromBoard(board);
    const before1 = canonicalize(store.patterns(1));
    const before2 = canonicalize(store.patterns(2));
    store.place({ row: 1, col: 3 }, 1);
    store.undo();
    expect(store.board[1][3]).toBe(0);
    expect(canonicalize(store.patterns(1))).toEqual(before1);
    expect(canonicalize(store.patterns(2))).toEqual(before2);
    expect(store.depth).toBe(0);
  });

  it("matches findPatterns after place sequence on an open-three board", () => {
    // Catalog #4-like: O open-three diagonal, X to answer.
    const board = parseBoard(`
      ............
      ............
      ............
      ............
      ............
      ....O.X.....
      .....O.X....
      ......O.....
      ............
      ............
      ............
      ............
    `);
    const store = PatternStore.fromBoard(board);
    expectStoreMatchesBoard(store);
    store.place({ row: 4, col: 9 }, 1);
    expectStoreMatchesBoard(store);
    store.place({ row: 5, col: 8 }, 2);
    expectStoreMatchesBoard(store);
    store.undo();
    expectStoreMatchesBoard(store);
    store.undo();
    expectStoreMatchesBoard(store);
  });

  it("resetFromBoard rebuilds cache and clears undo stack", () => {
    const board = parseBoard(`
      .....
      .XX..
      ..O..
      .....
    `);
    const store = PatternStore.fromBoard(board);
    store.place({ row: 1, col: 3 }, 1);
    const other = parseBoard(`
      .....
      .X...
      .....
      .....
    `);
    store.resetFromBoard(other);
    expect(store.depth).toBe(0);
    expect(store.board[1][1]).toBe(1);
    expect(store.board[1][2]).toBe(0);
    expectStoreMatchesBoard(store);
  });

  it("random walk of place/undo matches findPatterns", () => {
    const board = createEmptyBoard(20);
    board[10][10] = 1;
    board[10][11] = 2;
    const store = PatternStore.fromBoard(board);
    let player: Player = 1;
    const placed: Array<{ row: number; col: number; player: Player }> = [];

    for (let i = 0; i < 25; i += 1) {
      const candidates = findCandidateMoves(store.board);
      const move = candidates[i % candidates.length];
      store.place(move, player);
      placed.push({ ...move, player });
      expectStoreMatchesBoard(store);
      player = player === 1 ? 2 : 1;
    }

    for (let i = 0; i < placed.length; i += 1) {
      store.undo();
      expectStoreMatchesBoard(store);
    }
    expect(store.depth).toBe(0);
  });
});
