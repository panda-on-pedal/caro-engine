import { createEmptyBoard, placeMove, type Board, type Player } from "../board.ts";
import {
  canonicalExperienceKey,
  computeSettleTransition,
  DEFAULT_SETTLE_GIVE_UP_SEARCHES,
  ExperienceStore,
  experienceBeatsBaseline,
  isStrongExperienceHit,
  shouldReplaceExperience,
  toCanonicalBoard,
  type ExperienceEntry,
} from "./experience.ts";
import { tryUseExperienceHit } from "./experienceLookup.ts";

const m = (row: number, col: number) => ({ row, col });

/** Rotate/reflect a stone list onto a fresh board of the same size. */
function build(size: number, stones: Array<[number, number, Player]>): Board {
  let board = createEmptyBoard(size);
  for (const [r, c, p] of stones) {
    board = placeMove(board, r, c, p);
  }
  return board;
}

describe("canonicalExperienceKey", () => {
  it("maps empty and single-stone boards to EMPTY (openings are not booked)", () => {
    const empty = createEmptyBoard(5);
    const one = build(5, [[2, 2, 1]]);
    expect(canonicalExperienceKey(empty, 1).key).toBe("EMPTY");
    expect(canonicalExperienceKey(one, 1).key).toBe("EMPTY");
    expect(canonicalExperienceKey(one, 2).key).toBe("EMPTY");
  });

  it("differs by side to move on the same board", () => {
    const board = build(5, [
      [2, 2, 1],
      [2, 3, 2],
    ]);
    expect(canonicalExperienceKey(board, 1).key).not.toBe(canonicalExperienceKey(board, 2).key);
  });

  it("collapses the 8 symmetries onto one key", () => {
    // An L-shaped cluster near the center (away from every edge).
    const base = build(15, [
      [6, 6, 1],
      [6, 7, 1],
      [7, 6, 2],
    ]);
    const baseKey = canonicalExperienceKey(base, 1).key;

    // rot90 of the same cluster around the board center.
    const rot90 = build(15, [
      [6, 8, 1],
      [7, 8, 1],
      [6, 7, 2],
    ]);
    expect(canonicalExperienceKey(rot90, 1).key).toBe(baseKey);
  });

  it("is translation invariant away from edges", () => {
    const a = build(15, [
      [5, 5, 1],
      [5, 6, 2],
    ]);
    const b = build(15, [
      [9, 9, 1],
      [9, 10, 2],
    ]);
    expect(canonicalExperienceKey(a, 1).key).toBe(canonicalExperienceKey(b, 1).key);
  });

  it("distinguishes an edge-blocked shape from the same shape in open space", () => {
    const openShape = build(15, [
      [7, 7, 1],
      [7, 8, 1],
    ]);
    const edgeShape = build(15, [
      [0, 7, 1],
      [0, 8, 1],
    ]);
    expect(canonicalExperienceKey(openShape, 1).key).not.toBe(
      canonicalExperienceKey(edgeShape, 1).key
    );
  });

  it("round-trips a move through the chosen transform", () => {
    const board = build(15, [
      [6, 6, 1],
      [6, 7, 2],
    ]);
    const { transform } = canonicalExperienceKey(board, 1);
    const move = { row: 6, col: 8 };
    const back = transform.fromCanonical(transform.toCanonical(move));
    expect(back).toEqual(move);
  });

  it("replays a stored move correctly onto a rotated position", () => {
    const base = build(15, [
      [6, 6, 1],
      [6, 7, 1],
      [7, 6, 2],
    ]);
    const baseCanon = canonicalExperienceKey(base, 1);
    // The move we would store, expressed in the canonical frame.
    const canonicalMove = baseCanon.transform.toCanonical({ row: 6, col: 8 });

    const rot90 = build(15, [
      [6, 8, 1],
      [7, 8, 1],
      [6, 7, 2],
    ]);
    const rotCanon = canonicalExperienceKey(rot90, 1);
    expect(rotCanon.key).toBe(baseCanon.key);
    // Projecting the same canonical move onto the rotated board yields a legal,
    // geometrically-consistent cell.
    const replayed = rotCanon.transform.fromCanonical(canonicalMove);
    expect(rot90[replayed.row][replayed.col]).toBe(0);
  });
});

describe("experience comparison helpers", () => {
  it("treats deeper or equal-depth higher score as better", () => {
    expect(
      experienceBeatsBaseline(
        { move: { row: 0, col: 0 }, score: 10, depth: 4 },
        { move: { row: 1, col: 1 }, score: 99, depth: 3 }
      )
    ).toBe(true);
    expect(
      experienceBeatsBaseline(
        { move: { row: 0, col: 0 }, score: 50, depth: 3 },
        { move: { row: 1, col: 1 }, score: 40, depth: 3 }
      )
    ).toBe(true);
    expect(
      experienceBeatsBaseline(
        { move: { row: 0, col: 0 }, score: 10, depth: 3 },
        { move: { row: 1, col: 1 }, score: 40, depth: 3 }
      )
    ).toBe(false);
  });

  it("trusts any entry backed by a real search, rejects depth-0", () => {
    expect(isStrongExperienceHit({ move: { row: 0, col: 0 }, score: 1, depth: 1 })).toBe(true);
    expect(isStrongExperienceHit({ move: { row: 0, col: 0 }, score: 1, depth: 0 })).toBe(false);
    expect(isStrongExperienceHit(undefined)).toBe(false);
  });

  it("replaces when next is at least as good", () => {
    expect(
      shouldReplaceExperience(undefined, {
        move: { row: 0, col: 0 },
        score: 0,
        depth: 1,
      })
    ).toBe(true);
    expect(
      shouldReplaceExperience(
        { move: { row: 0, col: 0 }, score: 10, depth: 4 },
        { move: { row: 1, col: 1 }, score: 10, depth: 4 }
      )
    ).toBe(true);
    expect(
      shouldReplaceExperience(
        { move: { row: 0, col: 0 }, score: 10, depth: 4 },
        { move: { row: 1, col: 1 }, score: 9, depth: 4 }
      )
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
      settleLevel: 0,
      stallCount: 0,
    });
  });
});

describe("tryUseExperienceHit", () => {
  it("returns instantly in use mode with a real legal hit", () => {
    let board = createEmptyBoard(5);
    board = placeMove(board, 2, 2, 1);
    const entry = { move: { row: 2, col: 3 }, score: 5, depth: 2 };
    expect(
      tryUseExperienceHit({
        board,
        player: 2,
        mode: "use",
        entry,
      })?.move
    ).toEqual(entry.move);
  });

  it("does not fire in practice on a non-permanent entry", () => {
    let board = createEmptyBoard(5);
    board = placeMove(board, 2, 2, 1);
    const entry = { move: { row: 2, col: 3 }, score: 5, depth: 2, stallCount: 0 };
    expect(
      tryUseExperienceHit({
        board,
        player: 2,
        mode: "practice",
        entry,
      })
    ).toBeNull();
  });

  it("fires in practice when stallCount reaches the give-up threshold", () => {
    let board = createEmptyBoard(5);
    board = placeMove(board, 2, 2, 1);
    const entry = {
      move: { row: 2, col: 3 },
      score: 5,
      depth: 2,
      stallCount: DEFAULT_SETTLE_GIVE_UP_SEARCHES,
    };
    const hit = tryUseExperienceHit({
      board,
      player: 2,
      mode: "practice",
      entry,
    });
    expect(hit?.move).toEqual(entry.move);
    expect(hit?.experienceCacheHit).toBe(true);
    expect(hit?.experienceStreakEligible).toBe(true);
  });

  it("does not fire on a depth-0 entry", () => {
    let board = createEmptyBoard(5);
    board = placeMove(board, 2, 2, 1);
    expect(
      tryUseExperienceHit({
        board,
        player: 2,
        mode: "use",
        entry: { move: { row: 2, col: 3 }, score: 5, depth: 0 },
      })
    ).toBeNull();
  });
});

describe("computeSettleTransition", () => {
  const cand: ExperienceEntry = { move: m(1, 1), score: 100, depth: 4 };

  it("stores a brand-new entry at level 0, stall 0", () => {
    expect(computeSettleTransition(undefined, cand, 3)).toEqual({
      action: "put",
      settleLevel: 0,
      stallCount: 0,
      permanent: false,
      emit: true,
      kind: "new",
    });
  });

  it("still climbs the settle level (never resets) when a deeper result changes the move", () => {
    const prev: ExperienceEntry = {
      move: m(2, 2),
      score: 90,
      depth: 3,
      settleLevel: 2,
      stallCount: 1,
    };
    expect(computeSettleTransition(prev, cand, 3)).toEqual({
      action: "put",
      settleLevel: 3,
      stallCount: 0,
      permanent: false,
      emit: true,
      kind: "improved",
    });
  });

  it("climbs one settle level (stall reset) on a same-move refinement", () => {
    const prev: ExperienceEntry = {
      move: m(1, 1),
      score: 90,
      depth: 4,
      settleLevel: 0,
      stallCount: 2,
    };
    expect(computeSettleTransition(prev, cand, 3)).toEqual({
      action: "put",
      settleLevel: 1,
      stallCount: 0,
      permanent: false,
      emit: true,
      kind: "improved",
    });
  });

  it("increments stall (not yet permanent) on a stall below the give-up threshold", () => {
    const prev: ExperienceEntry = {
      move: m(1, 1),
      score: 100,
      depth: 4,
      settleLevel: 2,
      stallCount: 0,
    };
    expect(computeSettleTransition(prev, cand, 3)).toEqual({
      action: "setStall",
      settleLevel: 2,
      stallCount: 1,
      permanent: false,
      emit: true,
      kind: "stalled",
    });
  });

  it("freezes (settled) when a stall reaches the give-up threshold", () => {
    const prev: ExperienceEntry = {
      move: m(1, 1),
      score: 100,
      depth: 4,
      settleLevel: 2,
      stallCount: 2,
    };
    expect(computeSettleTransition(prev, cand, 3)).toEqual({
      action: "setStall",
      settleLevel: 2,
      stallCount: 3,
      permanent: true,
      emit: true,
      kind: "settled",
    });
  });

  it("does nothing for an already-permanent entry", () => {
    const prev: ExperienceEntry = {
      move: m(1, 1),
      score: 90,
      depth: 4,
      settleLevel: 2,
      stallCount: 3,
    };
    expect(computeSettleTransition(prev, cand, 3)).toEqual({
      action: "none",
      settleLevel: 2,
      stallCount: 3,
      permanent: true,
      emit: false,
      kind: "settled",
    });
  });
});

describe("ExperienceStore.setStallCount", () => {
  it("raises the stall counter monotonically without touching move/score", () => {
    const store = new ExperienceStore();
    store.put("k", { move: m(1, 1), score: 100, depth: 4, settleLevel: 0, stallCount: 0 });
    expect(store.setStallCount("k", 3)).toBe(true);
    expect(store.get("k")).toMatchObject({
      move: m(1, 1),
      score: 100,
      depth: 4,
      stallCount: 3,
    });
    expect(store.setStallCount("k", 3)).toBe(false);
    expect(store.setStallCount("k", 2)).toBe(false);
    expect(store.setStallCount("missing", 3)).toBe(false);
  });
});

it("DEFAULT_SETTLE_GIVE_UP_SEARCHES is 3", () => {
  expect(DEFAULT_SETTLE_GIVE_UP_SEARCHES).toBe(3);
});

describe("toCanonicalBoard", () => {
  it("produces a board whose own canonical key is the identity key", () => {
    const board = createEmptyBoard();
    board[5][5] = 1;
    board[5][6] = 1;
    board[6][6] = 2;
    const { key, transform } = canonicalExperienceKey(board, 1);

    const canonical = toCanonicalBoard(board, transform);
    const rekey = canonicalExperienceKey(canonical, 1);
    // Shape body is preserved; edge codes can differ because stones sit at the
    // origin of the canonical board (closer to the wall than on the original).
    expect(rekey.key.split("#")[0]).toBe(key.split("#")[0]);
    const probe = { row: 0, col: 1 };
    expect(rekey.transform.toCanonical(probe)).toEqual(probe);
  });
});

describe("ExperienceStore eviction callback", () => {
  it("invokes onEvict with each key dropped by LRU overflow", () => {
    const evicted: string[] = [];
    const store = new ExperienceStore(1, key => evicted.push(key));
    store.put("A", { move: { row: 0, col: 0 }, score: 1, depth: 1 });
    store.put("B", { move: { row: 1, col: 1 }, score: 1, depth: 1 });
    expect(evicted).toEqual(["A"]);
  });
});
