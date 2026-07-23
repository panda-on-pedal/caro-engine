import {
  evaluate,
  forkBonusFor,
  FORK_BONUS_SCALE,
  RANK_PATTERN_WEIGHTS,
  WIN_SCORE,
} from "./evaluate.ts";
import { findForkPoints, findPatterns } from "../patterns/patterns.ts";
import { parseBoard } from "../test-helpers/parse-board.ts";

describe("evaluate", () => {
  it("scores an open-four position higher than an open-three position for the same player", () => {
    const openFourBoard = parseBoard(".XXXX..");
    const openThreeBoard = parseBoard(".XXX...");
    expect(evaluate(openFourBoard, 1)).toBeGreaterThan(evaluate(openThreeBoard, 1));
  });

  it("scores an open-three position higher than a plain-two position for the same player", () => {
    const openThreeBoard = parseBoard(".XXX...");
    const twoBoard = parseBoard(".XX....");
    expect(evaluate(openThreeBoard, 1)).toBeGreaterThan(evaluate(twoBoard, 1));
  });

  it("gives the side to move a tempo bonus over an otherwise symmetric position", () => {
    const board = parseBoard(`
      .XXX...
      .......
      .OOO...
    `);
    const scoreXToMove = evaluate(board, 1);
    const scoreOToMove = evaluate(board, 2);
    expect(scoreXToMove).toBeGreaterThan(-scoreOToMove);
  });

  it("returns WIN_SCORE when the player to move already has a five on the board", () => {
    const board = parseBoard(".XXXXX.");
    expect(evaluate(board, 1)).toBe(WIN_SCORE);
  });

  it("returns -WIN_SCORE when the opponent already has a five on the board", () => {
    const board = parseBoard(".OOOOO.");
    expect(evaluate(board, 1)).toBe(-WIN_SCORE);
  });
});

describe("forkBonusFor", () => {
  it("scales the sum of RANK_PATTERN_WEIGHTS for contributing lines", () => {
    const board = parseBoard(`
      .......
      .....X.
      ..XXX..
      .....X.
      .......
    `);
    const forkPoint = findForkPoints(findPatterns(board, 1))[0];
    const expected =
      forkPoint.patterns.reduce((sum, p) => sum + RANK_PATTERN_WEIGHTS[p.type], 0) *
      FORK_BONUS_SCALE;
    expect(forkBonusFor(forkPoint)).toBe(expected);
  });
});
