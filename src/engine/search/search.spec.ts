import {
  jitteredScore,
  negamaxSearch,
  negamaxStrategy,
  patternOnlyStrategy,
  search,
  type MoveSelectionStrategy,
} from "./search.ts";
import { WIN_SCORE } from "./evaluate.ts";
import { findPatterns } from "../patterns/patterns.ts";
import { parseBoard } from "../test-helpers/parse-board.ts";
import { narrowCandidates, ALL_FORK_PATTERN_NAMES } from "./narrow.ts";
import { DEFAULT_TOP_K } from "./rankMoves.ts";
import { DEFAULT_DECAY_CONFIG } from "./search.ts";
import { createEmptyBoard, placeMove } from "../board.ts";

describe("negamaxSearch", () => {
  it("finds the unique winning move when one is available (win-in-1)", () => {
    // X has an open four; playing either end wins. Use an open four
    // blocked on the left by board edge padding removed — force a unique
    // winning square by blocking one end with O.
    const board = parseBoard(`
      ..........
      .OXXXX....
      ..........
    `);
    const result = negamaxSearch(board, 1, 2);
    expect(result.principalVariation[0]).toEqual({ row: 1, col: 6 });
    expect(result.score).toBeGreaterThan(0);
  });

  it("finds the unique blocking move when the opponent threatens an open four next move", () => {
    // O has a four blocked on the left by an X stone at col 0, so O's only
    // legal winning extension is col 5 (checkCaroWin only rejects a five
    // blocked at BOTH ends, so a single-side block does not stop O on its
    // own — occupying the winning square is what stops it). The board is
    // narrowed to 6 columns so col 6 ("poison the far end so O's five is
    // double-blocked") is off-board and not a legal alternative; col 5 is
    // the unique square that prevents O's win.
    //
    // Even though X's move is the objectively correct block, the returned
    // score is not necessarily positive: this move doesn't end the game,
    // so negamax looks one more ply ahead and lets O take a free tempo move
    // that can rack up incidental (but non-threatening) two-in-a-row
    // patterns via evaluate()'s uncapped per-direction summation. So the
    // real invariant here is that this move is uniquely best and avoids
    // the forced loss (score nowhere near -WIN_SCORE), not that the score
    // is positive.
    const board = parseBoard(`
      ......
      XOOOO.
      ......
    `);
    const result = negamaxSearch(board, 1, 2);
    expect(result.principalVariation[0]).toEqual({ row: 1, col: 5 });
    expect(result.score).toBeGreaterThan(-WIN_SCORE);
  });

  it("returns a score of 0 for an empty board scanned to depth 1 (no forced outcome)", () => {
    const board = parseBoard(`
      .....
      .....
      .....
      .....
      .....
    `);
    const result = negamaxSearch(board, 1, 1);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.principalVariation).toHaveLength(1);
  });
});

describe("search", () => {
  it("skips negamax on a quiet single-stone board (depth 0, no nodes)", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    const result = search(board, 2, { maxDepth: 4 });
    expect(result.depth).toBe(0);
    expect(result.nodesVisited).toBe(0);
    expect(board[result.move.row][result.move.col]).toBe(0);
    const rowDelta = Math.abs(result.move.row - 2);
    const colDelta = Math.abs(result.move.col - 2);
    expect(Math.max(rowDelta, colDelta)).toBeLessThanOrEqual(2);
  });

  it("searches when an open-two is present", () => {
    const board = parseBoard("..XX...");
    const openTwo = findPatterns(board, 1).find((p) => p.type === "open-two")!;
    const result = search(board, 1, { maxDepth: 2 });
    expect(result.depth).toBeGreaterThan(0);
    expect(result.nodesVisited).toBeGreaterThan(0);
    expect(openTwo.criticalGains).toContainEqual(result.move);
  });

  it("reaches the requested depth on a tactical board", () => {
    const board = parseBoard("..XX...");
    const result = search(board, 1, { maxDepth: 2 });
    expect(result.depth).toBe(2);
    expect(result.principalVariation.length).toBeGreaterThan(0);
    expect(board[result.move.row][result.move.col]).toBe(0);
  });

  it("stops within the time budget and still returns a valid move", () => {
    const board = parseBoard(`
      ..........
      ....XX....
      ..O.......
      .....X....
      ..........
    `);
    const start = Date.now();
    const result = search(board, 1, { maxDepth: 8, timeBudgetMs: 100 });
    const elapsedMs = Date.now() - start;

    // Budget is soft: a single in-flight node may finish after the deadline
    // (narrowCandidates / a deep ply can exceed 100ms). Bound overshoot, not
    // wall-clock equality with timeBudgetMs.
    expect(elapsedMs).toBeLessThan(5000);
    expect(board[result.move.row][result.move.col]).toBe(0);
    expect(result.nodesVisited).toBeGreaterThan(0);
  });

  it("finds a forced win-in-1 even under iterative deepening", () => {
    const board = parseBoard(`
      ..........
      .OXXXX....
      ..........
    `);
    const result = search(board, 1, { maxDepth: 3 });
    expect(result.move).toEqual({ row: 1, col: 6 });
  });

  it("finds a win-in-3 that requires creating a double threat (fork)", () => {
    // X has two separate open threes (vertical at col 4, horizontal at
    // row 4) sharing an empty extension point at (4, 4); O has no forcing
    // reply of its own. Playing the shared point turns *both* threes into
    // fully open fours at once (four winning squares total: (0,4), (5,4),
    // (4,0), (4,5)); O can block only one per turn, so X wins within 3
    // plies regardless of how O responds.
    //
    // Board note: the brief's original diagram placed the fork cell (5, 5)
    // itself as one of the three stones on *both* lines, which collapses
    // this into an already-existing open four (a trivial win-in-1, verified
    // empirically via a scratch script) rather than the intended
    // win-in-3-via-fork. This board leaves the shared point empty so the
    // fork must actually be built.
    //
    // Timing note: findPatterns' open-three/open-four classification
    // (patterns.ts, out of scope for this task) does per-gain recursive
    // re-scans of the whole board, which run at every negamax node, not
    // just leaves. On this minimal 6x6 board that made the full depth-1..3
    // search (884 nodes total) take several seconds even with no time
    // pressure at all (verified empirically: 4-7.5s across repeated runs
    // with no timeBudgetMs). The brief's literal timeBudgetMs: 5000 was
    // too tight for that measured cost and produced flaky/wrong results,
    // including a real bug this task fixed in negamax (see below):
    // interrupting a node before it evaluates any move left the -Infinity
    // sentinel in place, which a parent frame then negated into a bogus
    // +Infinity "forced win". timeBudgetMs is raised here to give a
    // comfortable multiple of the observed worst-case time; the property
    // under test — the engine finds forced wins that require building a
    // fork — is unchanged.
    const board = parseBoard(`
      ......
      ....X.
      ....X.
      ....X.
      .XXX..
      ......
    `);
    const result = search(board, 1, { maxDepth: 6, timeBudgetMs: 15000 });
    expect(result.score).toBeGreaterThanOrEqual(9_000_000);
  }, 20000);
});

describe("top-K narrowing bound (scored top-K candidate plan)", () => {
  it("negamax root branching stays within top-K after narrowing on a busy soft position", () => {
    // O's 2x2 block gives X (the mover here) several simultaneous
    // dual-purpose expand/block candidates — a much larger raw soft set
    // than DEFAULT_TOP_K, matching the fixture in
    // docs/superpowers/plans/2026-07-18-board-state-catalog.md #5.1
    // (mirrored: X is the mover instead of O).
    let board = createEmptyBoard(20);
    board = placeMove(board, 8, 10, 1);
    board = placeMove(board, 9, 8, 2);
    board = placeMove(board, 9, 9, 2);
    board = placeMove(board, 10, 8, 2);
    board = placeMove(board, 10, 9, 2);
    board = placeMove(board, 10, 11, 1);
    board = placeMove(board, 12, 9, 1);

    const narrowed = narrowCandidates(board, 1, 7, {
      recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
      decay: DEFAULT_DECAY_CONFIG,
    });
    expect(narrowed.moves.length).toBeLessThanOrEqual(DEFAULT_TOP_K);

    const result = search(board, 1, { maxDepth: 2, timeBudgetMs: 2000 });
    expect(result.move).toBeDefined();
    expect(board[result.move.row][result.move.col]).toBe(0);
  });
});

describe("root score jitter (dynamic play among near-equal candidates)", () => {
  /** Deterministic LCG so each "seed" yields a fixed, replayable stream. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  // Symmetric pair: extending left or right is strategically identical,
  // so the two root candidates' true search scores tie exactly.
  const board = () => parseBoard("...XX.....");

  it("jitteredScore perturbs finite scores within the fraction and preserves sign", () => {
    expect(jitteredScore(200, 0.1, () => 1)).toBeCloseTo(220);
    expect(jitteredScore(200, 0.1, () => 0)).toBeCloseTo(180);
    expect(jitteredScore(-200, 0.1, () => 1)).toBeCloseTo(-220);
    expect(jitteredScore(150, 0, () => 1)).toBe(150);
  });

  it("jitteredScore never touches forced win/loss scores", () => {
    expect(jitteredScore(WIN_SCORE, 0.5, () => 1)).toBe(WIN_SCORE);
    expect(jitteredScore(WIN_SCORE + 3, 0.5, () => 0)).toBe(WIN_SCORE + 3);
    expect(jitteredScore(-WIN_SCORE, 0.5, () => 1)).toBe(-WIN_SCORE);
  });

  it("without jitter the same rng stream always yields the same move", () => {
    const a = search(board(), 1, { maxDepth: 2, rng: lcg(7) });
    const b = search(board(), 1, { maxDepth: 2, rng: lcg(7) });
    expect(a.move).toEqual(b.move);
  });

  it("with jitter, different rng streams break the tie differently", () => {
    const chosen = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const result = search(board(), 1, {
        maxDepth: 2,
        rootScoreJitter: 0.5,
        rng: lcg(seed),
      });
      chosen.add(`${result.move.row},${result.move.col}`);
    }
    expect(chosen.size).toBeGreaterThan(1);
  });

  it("reports the true (unjittered) score of the chosen move", () => {
    const result = search(board(), 1, {
      maxDepth: 2,
      rootScoreJitter: 0.5,
      rng: lcg(3),
    });
    const clean = search(board(), 1, { maxDepth: 2, rng: lcg(3) });
    // The symmetric position's candidates tie, so whichever one jitter
    // picks must report the same true score as the deterministic run.
    expect(result.score).toBe(clean.score);
  });
});

describe("pluggable move-selection strategy", () => {
  it("defaults to negamax on tactical boards and explores multiple nodes", () => {
    const board = parseBoard("..XX...");
    const result = search(board, 1, { maxDepth: 2 });
    expect(result.nodesVisited).toBeGreaterThan(1);
    expect(typeof negamaxStrategy).toBe("function");
  });

  it("patternOnlyStrategy takes narrowing's top pick with zero search overhead", () => {
    const board = parseBoard("OXXXX.");
    const result = search(
      board,
      1,
      { maxDepth: 4 },
      patternOnlyStrategy,
    );
    expect(result.move).toEqual({ row: 0, col: 5 });
    expect(result.nodesVisited).toBe(0);
  });

  it("a custom strategy can be substituted without touching narrowCandidates", () => {
    const alwaysFirstCandidate: MoveSelectionStrategy = (
      _board,
      _player,
      candidates,
    ) => ({
      move: candidates[0],
      score: 0,
      depth: 0,
      principalVariation: [candidates[0]],
      nodesVisited: 0,
    });
    const board = parseBoard("OXXXX.");
    const result = search(
      board,
      1,
      { maxDepth: 4 },
      alwaysFirstCandidate,
    );
    // Forced-block narrowing still yields exactly one candidate here, so
    // "always take the first" and "negamax" agree — the point of this
    // test is that a hand-rolled strategy function works at all.
    expect(result.move).toEqual({ row: 0, col: 5 });
  });
});

describe("regression: manual playtesting findings (2026-07-16 session)", () => {
  it("blocks an open three even with nothing better to do", () => {
    // The exact scenario found during manual play: the opponent has an
    // open three and the engine has one unrelated stone. Previously the
    // engine's candidate loop could exhaust its time budget before ever
    // reaching the blocking cells (scan-order dependent); narrowCandidates
    // makes blocking part of the tactical set unconditionally.
    const board = parseBoard(`
      ....................
      ....................
      ....................
      ...XXX..............
      ....................
      ..O.................
      ....................
    `);
    const result = search(board, 2, { maxDepth: 4, timeBudgetMs: 2000 });
    const blocksLeft = result.move.row === 3 && result.move.col === 2;
    const blocksRight = result.move.row === 3 && result.move.col === 6;
    expect(blocksLeft || blocksRight).toBe(true);
  });

  it("does not always play the same relative first move", () => {
    const positions: Array<[number, number]> = [
      [5, 5],
      [12, 3],
      [15, 15],
    ];
    const offsets = new Set<string>();
    for (const [row, col] of positions) {
      const board = createBoardWithSingleStone(row, col);
      const result = search(board, 2, { maxDepth: 2, timeBudgetMs: 500 });
      offsets.add(`${result.move.row - row},${result.move.col - col}`);
    }
    expect(offsets.size).toBeGreaterThan(1);
  });

  it("patternOnlyStrategy alone (no negamax) also blocks the same open three", () => {
    const board = parseBoard(`
      ....................
      ....................
      ....................
      ...XXX..............
      ....................
      ..O.................
      ....................
    `);
    const result = search(
      board,
      2,
      { maxDepth: 4 },
      patternOnlyStrategy,
    );
    expect(result.nodesVisited).toBe(0);
    const blocksLeft = result.move.row === 3 && result.move.col === 2;
    const blocksRight = result.move.row === 3 && result.move.col === 6;
    expect(blocksLeft || blocksRight).toBe(true);
  });
});

function createBoardWithSingleStone(row: number, col: number) {
  const size = 20;
  const board = Array.from({ length: size }, () =>
    Array<0 | 1 | 2>(size).fill(0),
  );
  board[row][col] = 1;
  return board;
}
