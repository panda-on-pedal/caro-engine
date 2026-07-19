import { checkCaroWin } from "./rules.ts";
import { ALL_FORK_PATTERN_NAMES, boxCell } from "./narrow.ts";
import { findPatterns } from "./patterns.ts";
import { PatternStore } from "./patternStore.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";
import {
  collectAttackThreatMoves,
  findForcedWin,
} from "./threatSearch.ts";

const forks = ALL_FORK_PATTERN_NAMES;

describe("exported defence helpers", () => {
  it("boxCell returns the outer box for a one-sided four on a wide board", () => {
    const board = parseBoard("OXXXX..");
    const four = findPatterns(board, 1).find((p) => p.type === "four");
    expect(four).toBeDefined();
    expect(boxCell(four!, board)).toEqual({ row: 0, col: 6 });
  });
});

describe("collectAttackThreatMoves", () => {
  it("includes four / open-four gains", () => {
    const board = parseBoard(".XXXX.");
    const store = PatternStore.fromBoard(board);
    const moves = collectAttackThreatMoves(store, 1, forks);
    const keys = new Set(moves.map((m) => `${m.row},${m.col}`));
    expect(keys.has("0,0")).toBe(true);
    expect(keys.has("0,5")).toBe(true);
  });

  it("includes open-three criticalGains", () => {
    const board = parseBoard("..XXX..");
    const store = PatternStore.fromBoard(board);
    const moves = collectAttackThreatMoves(store, 1, forks);
    const keys = new Set(moves.map((m) => `${m.row},${m.col}`));
    expect(keys.has("0,1")).toBe(true);
    expect(keys.has("0,5")).toBe(true);
  });
});

describe("findForcedWin", () => {
  it("proves an immediate open-four win", () => {
    const board = parseBoard(".XXXX.");
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, {
      maxPly: 4,
      recognizedForkPatterns: forks,
    });
    expect(result.won).toBe(true);
    expect(result.principalVariation.length).toBeGreaterThanOrEqual(1);
    const move = result.principalVariation[0];
    store.place(move, 1);
    expect(checkCaroWin(store.board, move.row, move.col, 1)).toBe(true);
    expect(store.depth).toBe(1);
    store.undo();
    expect(store.depth).toBe(0);
  });

  it("returns won:false on a quiet board", () => {
    const board = parseBoard(`
      ..........
      ....X.....
      .....O....
      ..........
    `);
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, {
      maxPly: 8,
      recognizedForkPatterns: forks,
    });
    expect(result.won).toBe(false);
    expect(result.principalVariation).toEqual([]);
    expect(store.depth).toBe(0);
  });

  it("proves a double open-three fork force at the shared gain", () => {
    const board = parseBoard(`
      .......
      .......
      O.XXX..
      .....X.
      .....X.
      .....X.
      .......
    `);
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, {
      maxPly: 8,
      recognizedForkPatterns: forks,
    });
    expect(result.won).toBe(true);
    expect(result.principalVariation[0]).toEqual({ row: 2, col: 5 });
    expect(store.depth).toBe(0);
  });

  it("stops when maxPly is 0", () => {
    const board = parseBoard(".XXXX.");
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, {
      maxPly: 0,
      recognizedForkPatterns: forks,
    });
    expect(result.won).toBe(false);
  });

  it("proves a multi-ply force from a double-open-two fork seed", () => {
    // Playing (2,5) creates a double open-three; after the forced reply,
    // the next threat completes the win — PV is at least 3 plies.
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `);
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, {
      maxPly: 16,
      recognizedForkPatterns: forks,
    });
    expect(result.won).toBe(true);
    expect(result.principalVariation.length).toBeGreaterThanOrEqual(3);
    expect(result.principalVariation[0]).toEqual({ row: 2, col: 5 });
    expect(store.depth).toBe(0);
  });

  it("does not treat open-three→open-four as a force when the defender already has a four (catalog #15)", () => {
    // X's 8,12 makes an open-four, but O already threatens 11,14 and would
    // win on the next turn if X ignores the four — not a forced win for X.
    const board = parseBoard(`
       8  9 10 11 12 13 14
    7  .  .  .  .  .  .  .
    8  .  .  X  .  .  .  .
    9  .  .  .  X  .  .  .
   10  .  .  X  O  X  .  .
   11  .  X  O  O  O  O  .
   12  .  .  .  .  .  .  .
    `);
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, {
      maxPly: 16,
      recognizedForkPatterns: forks,
    });
    expect(result.won).toBe(false);
    expect(result.principalVariation).toEqual([]);
    expect(store.depth).toBe(0);
  });
});
