import { createEmptyBoard, placeMove } from "./board.ts";
import {
  ExperienceStore,
  experienceBeatsBaseline,
  experiencePositionKey,
  isStrongExperienceHit,
  shouldReplaceExperience,
} from "./experience.ts";
import { tryUseExperienceHit } from "./experienceLookup.ts";

describe("experiencePositionKey", () => {
  it("differs by side to move on the same board", () => {
    let board = createEmptyBoard(5);
    board = placeMove(board, 2, 2, 1);
    expect(experiencePositionKey(board, 1)).not.toBe(
      experiencePositionKey(board, 2),
    );
  });
});

describe("experience comparison helpers", () => {
  it("treats deeper or equal-depth higher score as better", () => {
    expect(
      experienceBeatsBaseline(
        { move: { row: 0, col: 0 }, score: 10, depth: 4 },
        { move: { row: 1, col: 1 }, score: 99, depth: 3 },
      ),
    ).toBe(true);
    expect(
      experienceBeatsBaseline(
        { move: { row: 0, col: 0 }, score: 50, depth: 3 },
        { move: { row: 1, col: 1 }, score: 40, depth: 3 },
      ),
    ).toBe(true);
    expect(
      experienceBeatsBaseline(
        { move: { row: 0, col: 0 }, score: 10, depth: 3 },
        { move: { row: 1, col: 1 }, score: 40, depth: 3 },
      ),
    ).toBe(false);
  });

  it("gates strong hits by planned depth", () => {
    expect(
      isStrongExperienceHit({ move: { row: 0, col: 0 }, score: 1, depth: 6 }, 6),
    ).toBe(true);
    expect(
      isStrongExperienceHit({ move: { row: 0, col: 0 }, score: 1, depth: 5 }, 6),
    ).toBe(false);
  });

  it("replaces when next is at least as good", () => {
    expect(
      shouldReplaceExperience(undefined, {
        move: { row: 0, col: 0 },
        score: 0,
        depth: 1,
      }),
    ).toBe(true);
    expect(
      shouldReplaceExperience(
        { move: { row: 0, col: 0 }, score: 10, depth: 4 },
        { move: { row: 1, col: 1 }, score: 10, depth: 4 },
      ),
    ).toBe(true);
    expect(
      shouldReplaceExperience(
        { move: { row: 0, col: 0 }, score: 10, depth: 4 },
        { move: { row: 1, col: 1 }, score: 9, depth: 4 },
      ),
    ).toBe(false);
  });
});

describe("ExperienceStore", () => {
  it("evicts oldest entries when over capacity", () => {
    const store = new ExperienceStore(2);
    store.put("a", { move: { row: 0, col: 0 }, score: 1, depth: 1 });
    store.put("b", { move: { row: 0, col: 1 }, score: 1, depth: 1 });
    store.put("c", { move: { row: 0, col: 2 }, score: 1, depth: 1 });
    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")).toBeDefined();
    expect(store.get("c")).toBeDefined();
  });

  it("round-trips via loadAll/entries", () => {
    const store = new ExperienceStore();
    store.put("k", { move: { row: 3, col: 4 }, score: 12, depth: 6 });
    const clone = new ExperienceStore();
    clone.loadAll(store.entries());
    expect(clone.get("k")).toEqual({
      move: { row: 3, col: 4 },
      score: 12,
      depth: 6,
    });
  });
});

describe("tryUseExperienceHit", () => {
  it("returns instantly only in use mode with a strong legal hit", () => {
    let board = createEmptyBoard(5);
    board = placeMove(board, 2, 2, 1);
    const entry = { move: { row: 2, col: 3 }, score: 5, depth: 6 };
    expect(
      tryUseExperienceHit({
        board,
        player: 2,
        plannedDepth: 6,
        mode: "use",
        entry,
      })?.move,
    ).toEqual(entry.move);
    expect(
      tryUseExperienceHit({
        board,
        player: 2,
        plannedDepth: 6,
        mode: "practice",
        entry,
      }),
    ).toBeNull();
  });
});
