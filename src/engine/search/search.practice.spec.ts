// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { createEmptyBoard, placeMove } from "../board.ts";
import { search } from "./search.ts";

describe("search practice baseline", () => {
  it("keeps the baseline when search does not beat it", () => {
    let board = createEmptyBoard(11);
    board = placeMove(board, 5, 5, 1);
    board = placeMove(board, 5, 6, 2);
    board = placeMove(board, 6, 5, 1);
    board = placeMove(board, 6, 6, 2);

    const baseline = { move: { row: 4, col: 4 }, score: 1_000_000, depth: 6 };
    const result = search({ board: board, player: 1, maxDepth: 2,
      timeBudgetMs: 50,
      experienceMode: "practice",
      experienceBaseline: baseline,
      rootScoreJitter: 0, });

    expect(result.move).toEqual(baseline.move);
    expect(result.score).toBe(baseline.score);
    expect(result.depth).toBe(baseline.depth);
    expect(result.experienceCacheHit).toBe(true);
  });

  it("marks experienceCacheHit false when there is no usable baseline yet", () => {
    let board = createEmptyBoard(11);
    board = placeMove(board, 5, 5, 1);
    board = placeMove(board, 5, 6, 2);

    const result = search({ board: board, player: 1, maxDepth: 2,
      timeBudgetMs: 50,
      experienceMode: "practice",
      rootScoreJitter: 0, });

    expect(result.experienceCacheHit).toBe(false);
  });

  it("marks experienceStreakEligible false on a quiet single-stone board", () => {
    let board = createEmptyBoard(11);
    board = placeMove(board, 5, 5, 1);

    const result = search({ board: board, player: 2, maxDepth: 4,
      timeBudgetMs: 50,
      experienceMode: "practice",
      rootScoreJitter: 0, });

    expect(result.experienceStreakEligible).toBe(false);
  });

  it("marks experienceStreakEligible true when a real exploratory search runs", () => {
    let board = createEmptyBoard(11);
    board = placeMove(board, 5, 5, 1);
    board = placeMove(board, 5, 6, 2);
    board = placeMove(board, 6, 5, 1);
    board = placeMove(board, 6, 6, 2);

    const result = search({ board: board, player: 1, maxDepth: 2,
      timeBudgetMs: 50,
      experienceMode: "practice",
      rootScoreJitter: 0, });

    expect(result.experienceStreakEligible).toBe(true);
  });

  it("marks experienceCacheHit true when the search beats a weak baseline", () => {
    let board = createEmptyBoard(11);
    board = placeMove(board, 5, 5, 1);
    board = placeMove(board, 5, 6, 2);
    board = placeMove(board, 6, 5, 1);
    board = placeMove(board, 6, 6, 2);

    // Depth-1 baseline: a real maxDepth-2 search should out-depth it.
    const weakBaseline = { move: { row: 4, col: 4 }, score: 1, depth: 1 };
    const result = search({ board: board, player: 1, maxDepth: 2,
      timeBudgetMs: 50,
      experienceMode: "practice",
      experienceBaseline: weakBaseline,
      rootScoreJitter: 0, });

    expect(result.experienceCacheHit).toBe(true);
  });
});

describe("search experience baseline in use mode", () => {
  it("keeps the baseline in use mode when search does not beat it", () => {
    let board = createEmptyBoard(11);
    board = placeMove(board, 5, 5, 1);
    board = placeMove(board, 5, 6, 2);
    board = placeMove(board, 6, 5, 1);
    board = placeMove(board, 6, 6, 2);

    const baseline = { move: { row: 4, col: 4 }, score: 1_000_000, depth: 6 };
    const result = search({ board: board, player: 1, maxDepth: 2,
      timeBudgetMs: 50,
      experienceMode: "use",
      experienceBaseline: baseline,
      rootScoreJitter: 0, });

    expect(result.move).toEqual(baseline.move);
    expect(result.score).toBe(baseline.score);
    expect(result.depth).toBe(baseline.depth);
    expect(result.experienceCacheHit).toBeUndefined();
  });
});