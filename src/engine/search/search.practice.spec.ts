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
    const result = search(board, 1, {
      maxDepth: 2,
      timeBudgetMs: 50,
      experienceMode: "practice",
      experienceBaseline: baseline,
      rootScoreJitter: 0,
    });

    expect(result.move).toEqual(baseline.move);
    expect(result.score).toBe(baseline.score);
    expect(result.depth).toBe(baseline.depth);
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
    const result = search(board, 1, {
      maxDepth: 2,
      timeBudgetMs: 50,
      experienceMode: "use",
      experienceBaseline: baseline,
      rootScoreJitter: 0,
    });

    expect(result.move).toEqual(baseline.move);
    expect(result.score).toBe(baseline.score);
    expect(result.depth).toBe(baseline.depth);
  });
});
