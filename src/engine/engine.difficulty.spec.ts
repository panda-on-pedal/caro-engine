// src/engine/engine.difficulty.spec.ts
import {
  createEmptyBoard,
  isLegalMove,
  placeMove,
  type Board,
  type Player,
} from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { search, type SearchConfig } from "./search.ts";
import { ALL_FORK_PATTERN_NAMES } from "./narrow.ts";

const SMALL_BOARD_SIZE = 11;
const EASY_CONFIG: SearchConfig = {
  maxDepth: 2,
  timeBudgetMs: 200,
  recognizedForkPatterns: new Set(),
};
const HARD_CONFIG: SearchConfig = {
  maxDepth: 6,
  timeBudgetMs: 800,
  recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
};
const MAX_MOVES = SMALL_BOARD_SIZE * SMALL_BOARD_SIZE;

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

/** Plays hard (as player 1) against easy (as player 2) to completion or a move cap. Returns the winner, or null for a draw/cap. */
function playGame(hardPlayer: Player): Player | null {
  let board: Board = createEmptyBoard(SMALL_BOARD_SIZE);
  let toMove: Player = 1;

  for (let moveCount = 0; moveCount < MAX_MOVES; moveCount += 1) {
    const config = toMove === hardPlayer ? HARD_CONFIG : EASY_CONFIG;
    const result = search(board, toMove, config);
    if (!isLegalMove(board, result.move.row, result.move.col)) {
      return otherPlayer(toMove);
    }

    board = placeMove(board, result.move.row, result.move.col, toMove);
    if (checkCaroWin(board, result.move.row, result.move.col, toMove)) {
      return toMove;
    }
    toMove = otherPlayer(toMove);
  }
  return null;
}

describe("difficulty smoke test", () => {
  it("hard beats easy in the majority of self-play games", () => {
    const games = 3;
    let hardWins = 0;

    for (let i = 0; i < games; i += 1) {
      const hardPlayer: Player = i % 2 === 0 ? 1 : 2;
      const winner = playGame(hardPlayer);
      if (winner === hardPlayer) {
        hardWins += 1;
      }
    }

    expect(hardWins).toBeGreaterThan(games / 2);
  }, 60000);

  it("respects the time budget even at a high requested depth", () => {
    let board: Board = createEmptyBoard(SMALL_BOARD_SIZE);
    board = placeMove(board, 5, 5, 1);
    board = placeMove(board, 5, 6, 2);
    board = placeMove(board, 6, 5, 1);
    board = placeMove(board, 6, 6, 2);

    const start = Date.now();
    const result = search(board, 1, { maxDepth: 10, timeBudgetMs: 150 });
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    expect(isLegalMove(board, result.move.row, result.move.col)).toBe(true);
  });
});
