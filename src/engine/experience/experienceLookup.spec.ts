import { humanWinBookEntries } from "./experienceLookup.ts";
import { canonicalExperienceKey } from "./experience.ts";
import { createEmptyBoard } from "../board.ts";
import type { Move } from "../state.ts";

describe("humanWinBookEntries", () => {
  it("returns only the winning human's moves, skipping the empty-board opening", () => {
    // Player 1 = human. History alternates starting with player 1.
    const history: Move[] = [
      { row: 7, col: 7 }, // human (i=0) — opening, empty board → skipped
      { row: 7, col: 8 }, // ai    (i=1)
      { row: 8, col: 7 }, // human (i=2) — recorded
      { row: 8, col: 8 }, // ai    (i=3)
      { row: 9, col: 7 }, // human (i=4) — recorded
    ];

    const entries = humanWinBookEntries(history, 1);
    expect(entries).toHaveLength(2);

    // Entry 0 is keyed by the board BEFORE the i=2 human move (two stones down).
    const board = createEmptyBoard();
    board[7][7] = 1;
    board[7][8] = 2;
    const { key, transform } = canonicalExperienceKey(board, 1);
    expect(entries[0].key).toBe(key);
    expect(entries[0].move).toEqual(transform.toCanonical({ row: 8, col: 7 }));
  });

  it("keys player 2's moves as the human when humanPlayer is 2", () => {
    const history: Move[] = [
      { row: 7, col: 7 }, // ai    (i=0)
      { row: 7, col: 8 }, // human (i=1) — recorded (board has one stone)
    ];
    const entries = humanWinBookEntries(history, 2);
    expect(entries).toHaveLength(1);

    const board = createEmptyBoard();
    board[7][7] = 1;
    const { key, transform } = canonicalExperienceKey(board, 2);
    expect(entries[0].key).toBe(key);
    expect(entries[0].move).toEqual(transform.toCanonical({ row: 7, col: 8 }));
  });
});
