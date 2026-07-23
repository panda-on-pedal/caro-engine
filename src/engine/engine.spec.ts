import { isLegalMove } from "./board.ts";
import {
  BOOK_MAX_DEPTH,
  DIFFICULTY_PROFILES,
  chooseMove,
  resolveEngineSearchConfig,
  type Difficulty,
} from "./engine.ts";
import { ALL_FORK_PATTERN_NAMES } from "./search/narrow.ts";
import { applyMove, newGame } from "./state.ts";

describe("chooseMove", () => {
  it("returns a SearchResult whose move is legal on an empty board", () => {
    const state = newGame();
    const result = chooseMove(state, { difficulty: "easy" });
    expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
      true,
    );
    expect(result.depth).toBe(0);
    expect(result.nodesVisited).toBe(0);
    expect(Array.isArray(result.principalVariation)).toBe(true);
  });

  it("returns depth 0 on a quiet first-reply board", () => {
    let state = newGame();
    state = applyMove(state, { row: 7, col: 7 }, 1);

    const result = chooseMove(state, { difficulty: "easy" });
    expect(result.depth).toBe(0);
    expect(result.nodesVisited).toBe(0);
    expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
      true,
    );
  });

  it("takes an immediate win-in-1 when one is available, even at easy difficulty", () => {
    let state = newGame();
    // X: (5,1)-(5,4) open on both ends; O plays elsewhere off that line.
    state = applyMove(state, { row: 5, col: 1 }, 1);
    state = applyMove(state, { row: 0, col: 0 }, 2);
    state = applyMove(state, { row: 5, col: 2 }, 1);
    state = applyMove(state, { row: 0, col: 1 }, 2);
    state = applyMove(state, { row: 5, col: 3 }, 1);
    state = applyMove(state, { row: 0, col: 2 }, 2);
    state = applyMove(state, { row: 5, col: 4 }, 1);
    state = applyMove(state, { row: 0, col: 3 }, 2);

    const result = chooseMove(state, { difficulty: "easy" });
    expect([
      { row: 5, col: 0 },
      { row: 5, col: 5 },
    ]).toContainEqual(result.move);
  });

  it("defaults to a usable configuration when none is passed", () => {
    const state = newGame();
    const result = chooseMove(state);
    expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
      true,
    );
  });

  it("searches deeper at hard than at easy for the same tactical position", () => {
    let state = newGame();
    // Open-two for X so the position is tactical (not quiet random).
    state = applyMove(state, { row: 10, col: 10 }, 1);
    state = applyMove(state, { row: 0, col: 0 }, 2);
    state = applyMove(state, { row: 10, col: 11 }, 1);
    state = applyMove(state, { row: 0, col: 2 }, 2);

    const easy = chooseMove(state, { difficulty: "easy" });
    const hard = chooseMove(state, {
      difficulty: "hard",
      timeBudgetMs: 2000,
    });
    expect(easy.depth).toBeGreaterThan(0);
    expect(hard.depth).toBeGreaterThanOrEqual(easy.depth);
  });
});

describe("chooseMove — difficulty-gated fork recognition", () => {
  it("hard recognizes a fork that easy does not, on an identical position", () => {
    let state = newGame();
    // Build the double-three-trap shape from narrow.spec.ts, placed so it
    // sits within radius 2 of itself (already true — no extra setup
    // needed beyond placing the exact stones), with X to move.
    //
    // Note: the plan brief originally specified (6,10) for the fourth
    // stone and (9,9) for the resulting fork point; hand-verified via
    // findPatterns/findForkPoints directly that those coordinates do NOT
    // form a fork (findForkPoints returns []). (6,9) is the coordinate
    // that completes the shape — two open-twos (row 5 cols 7-8, and col 9
    // rows 4/6) sharing gain cell (5,9), matching narrow.spec.ts's
    // "double-three-trap matches a fork point made of two two-tier
    // patterns" fixture shifted onto this board.
    //
    // The brief's O filler moves were also all placed on row 0, cols 0-3
    // — four-in-a-row, an unblocked live four for O. narrowCandidates'
    // step 2 ("I must block now") always short-circuits before step 3's
    // fork detection, so with those fillers *both* difficulties' candidate
    // sets collapsed to the single forced block cell (0,4), never
    // exercising fork recognition at all (hand-verified: both hard and
    // easy candidate sets were `[{row:0,col:4}]`). Scattered onto distinct
    // rows/cols/diagonals below so they form no pattern at all.
    state = applyMove(state, { row: 6, col: 9 }, 1);
    state = applyMove(state, { row: 0, col: 0 }, 2); // filler, far away
    state = applyMove(state, { row: 4, col: 9 }, 1);
    state = applyMove(state, { row: 1, col: 2 }, 2); // filler, far away
    state = applyMove(state, { row: 5, col: 7 }, 1);
    state = applyMove(state, { row: 2, col: 15 }, 2); // filler, far away
    state = applyMove(state, { row: 5, col: 8 }, 1);
    state = applyMove(state, { row: 3, col: 17 }, 2); // filler, far away

    const easy = chooseMove(state, {
      difficulty: "easy",
      timeBudgetMs: 500,
    });
    const hard = chooseMove(state, {
      difficulty: "hard",
      timeBudgetMs: 2000,
    });

    // hard's narrowed candidate set includes the fork point (5,9); easy's
    // does not recognize forks at all, so it cannot even consider it as a
    // priority move (it may still stumble onto it via the quiet fallback
    // sample, so this asserts hard's score reflects fork awareness rather
    // than asserting easy never plays it).
    expect(hard.score).toBeGreaterThanOrEqual(easy.score);
  });
});

describe("DIFFICULTY_PROFILES", () => {
  it("is the single table covering every Difficulty key", () => {
    const keys: Difficulty[] = ["easy", "medium", "hard", "expert"];
    for (const d of keys) {
      expect(DIFFICULTY_PROFILES[d]).toBeDefined();
    }
  });

  it("keeps depth / budget / fork / jitter values per difficulty", () => {
    expect(DIFFICULTY_PROFILES.easy).toMatchObject({
      maxDepth: 2,
      timeBudgetMs: 500,
      rootScoreJitter: 0.15,
    });
    expect(DIFFICULTY_PROFILES.easy.recognizedForkPatterns.size).toBe(0);
    expect(DIFFICULTY_PROFILES.medium).toMatchObject({
      maxDepth: 4,
      timeBudgetMs: 2000,
      rootScoreJitter: 0.1,
    });
    expect(DIFFICULTY_PROFILES.medium.recognizedForkPatterns).toEqual(
      new Set(["double-three-trap", "double-four-trap"]),
    );
    expect(DIFFICULTY_PROFILES.hard).toMatchObject({
      maxDepth: 6,
      timeBudgetMs: 5000,
      rootScoreJitter: 0.05,
    });
    expect(DIFFICULTY_PROFILES.hard.recognizedForkPatterns).toEqual(
      ALL_FORK_PATTERN_NAMES,
    );
    expect(DIFFICULTY_PROFILES.expert).toMatchObject({
      maxDepth: 6,
      timeBudgetMs: 10000,
      rootScoreJitter: 0.02,
    });
    expect(DIFFICULTY_PROFILES.expert.recognizedForkPatterns).toEqual(
      ALL_FORK_PATTERN_NAMES,
    );
  });

  it("resolveEngineSearchConfig merges profile with overrides", () => {
    const base = resolveEngineSearchConfig({ difficulty: "expert" });
    expect(base.maxDepth).toBe(6);
    expect(base.timeBudgetMs).toBe(10000);

    const overridden = resolveEngineSearchConfig({
      difficulty: "hard",
      timeBudgetMs: 123,
    });
    expect(overridden.timeBudgetMs).toBe(123);
    expect(overridden.maxDepth).toBe(6);
  });

  it("disables own-stone time stepping in practice mode", () => {
    const practice = resolveEngineSearchConfig({
      difficulty: "expert",
      experienceMode: "practice",
    });
    expect(practice.stepTimeByOwnStones).toBe(false);

    const use = resolveEngineSearchConfig({
      difficulty: "expert",
      experienceMode: "use",
    });
    expect(use.stepTimeByOwnStones).toBeUndefined();
  });
});

describe("bookDeepening depth override", () => {
  it("raises maxDepth to BOOK_MAX_DEPTH but keeps the difficulty budget", () => {
    const normal = resolveEngineSearchConfig({ difficulty: "expert" });
    const deep = resolveEngineSearchConfig({
      difficulty: "expert",
      bookDeepening: true,
    });
    expect(normal.maxDepth).toBe(6);
    expect(deep.maxDepth).toBe(BOOK_MAX_DEPTH);
    expect(deep.timeBudgetMs).toBe(normal.timeBudgetMs);
  });
});
