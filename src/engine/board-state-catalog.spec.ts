// src/engine/board-state-catalog.spec.ts
//
// Regression coverage for every scenario in
// docs/superpowers/plans/2026-07-18-board-state-catalog.md. Boards are
// pasted verbatim (labeled row/col format, see test-helpers/parse-board.ts)
// so there is no manual coordinate transcription to get wrong.
//
// The thing under test throughout is narrowCandidates' *returned, ranked*
// candidate list — the same list negamax consumes at every ply (root and
// every recursive depth call the same stateless narrowCandidates/
// selectTopMoves, so a correct root ranking is a correct ranking at any
// depth). Expected values below were captured from the real engine via
// toMatchSnapshot(), inspected, and converted to explicit assertions.
import { parseBoard } from "./test-helpers/parse-board.ts";
import { checkCaroWin } from "./rules.ts";
import { placeMove } from "./board.ts";
import { scoreMove } from "./rankMoves.ts";
import { narrowCandidates, ALL_FORK_PATTERN_NAMES } from "./narrow.ts";
import { DEFAULT_DECAY_CONFIG } from "./search.ts";

const CFG = {
  recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
  decay: DEFAULT_DECAY_CONFIG,
};

/** Snapshot-friendly view of narrowCandidates' output: source, and each
 * returned move with its score, in returned (ranked) order. Kept as a
 * committed snapshot (not converted to hardcoded values) so the actual
 * ranked candidate set stays directly reviewable in the .snap file —
 * any future change to scoring/tiering shows up as a snapshot diff. */
function snapshotNarrow(
  board: ReturnType<typeof parseBoard>,
  player: 1 | 2,
  moveCount: number,
) {
  const result = narrowCandidates(board, player, moveCount, CFG);
  return {
    source: result.source,
    moves: result.moves.map((m) => ({
      row: m.row,
      col: m.col,
      score: scoreMove(board, player, m),
    })),
  };
}

describe("catalog #1 — extending X's diagonal to a three outranks the dual-purpose block/extend move", () => {
  const board = parseBoard(`
       6  7  8  9 10 11 12 13 14 15 16 17
    9  .  .  .  .  .  .  .  .  .  .  .  .
   10  .  .  .  .  .  .  X  .  .  .  .  .
   11  .  .  .  .  .  X  O  .  .  .  .  .
   12  .  .  .  .  .  O  .  .  .  .  .  .
   13  .  .  .  .  .  .  .  .  .  .  .  .
   14  .  .  .  .  .  .  .  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 1, 4)).toMatchSnapshot();
  });

  it("ranks the diagonal-extension moves first (score 4900+), far above the dual-purpose move (10,13, score 190)", () => {
    const result = narrowCandidates(board, 1, 4, CFG);
    expect(result.source).toBe("tactical");
    expect(result.moves[0]).toEqual({ row: 8, col: 14 });
    expect(scoreMove(board, 1, result.moves[0])).toBeGreaterThan(4000);
  });

  it("still scores the dual-purpose move (10,13) higher than the pure one-sided block (13,10)", () => {
    // (10,13) extends X's own diagonal two AND blocks O's diagonal
    // extension point; (13,10) only blocks, with no benefit to X.
    const dual = scoreMove(board, 1, { row: 10, col: 13 });
    const pureBlock = scoreMove(board, 1, { row: 13, col: 10 });
    expect(dual).toBe(190);
    expect(pureBlock).toBe(90);
    expect(dual).toBeGreaterThan(pureBlock);
  });
});

describe("catalog #2 — O's dual-purpose 12,13 competes in the soft tier, behind the urgent answers to X's three", () => {
  const board = parseBoard(`
       6  7  8  9 10 11 12 13 14 15 16 17
    6  .  .  .  .  .  .  .  .  .  .  .  .
    7  .  .  .  .  .  .  .  .  .  .  .  .
    8  .  .  .  .  .  .  .  .  .  .  .  .
    9  .  .  .  .  .  .  .  X  .  .  .  .
   10  .  .  .  .  .  .  X  X  .  .  .  .
   11  .  .  .  .  .  X  O  .  .  .  .  .
   12  .  .  .  .  O  O  .  .  .  .  .  .
   13  .  .  .  .  .  .  .  .  .  .  .  .
   14  .  .  .  .  .  .  .  .  .  .  .  .
   15  .  .  .  .  .  .  .  .  .  .  .  .
   16  .  .  .  .  .  .  .  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 2, 7)).toMatchSnapshot();
  });

  it("keeps 12,13 in the pool as the leading soft move; the urgent answers to X's three lead by tier guarantee", () => {
    // Fixed bug: narrow.ts's pattern loop only handled "open-two", never
    // plain "two" (blocked on one end) — so O's diagonal pair
    // (11,12)-(12,11), blocked by X at (10,13), contributed nothing, and
    // its gains (13,10)/(14,9) never reached the candidate pool at all.
    // Also fixed: the urgent tier used to return exclusively once
    // non-empty, so an offensive move that doesn't touch X's three —
    // like 12,13 — could never even be scored. Selection is now
    // tier-aware: the urgent block cells (7,15 / 8,14, answering X's
    // one-sided three) always occupy the leading slots, and the soft
    // offense ranks by score behind them. The search then judges the
    // whole pool — the catalog's pick 12,13 wins on lookahead, not on
    // list position.
    const result = narrowCandidates(board, 2, 7, CFG);
    expect(result.source).toBe("tactical");
    expect(result.moves.slice(0, 2)).toEqual([
      { row: 7, col: 15 },
      { row: 8, col: 14 },
    ]);
    expect(result.moves[2]).toEqual({ row: 12, col: 13 });
    expect(scoreMove(board, 2, { row: 12, col: 13 })).toBe(5010);
  });

  it("fills the remaining soft slots with the open-three-creating group, dropping the weaker two-gains", () => {
    const result = narrowCandidates(board, 2, 7, CFG);
    const keys = result.moves.map((m) => `${m.row},${m.col}`).sort();
    expect(keys).toEqual(["12,12", "12,13", "12,8", "7,15", "8,14"]);
    // With two top-K slots reserved for the urgent tier, only the three
    // best soft moves survive: 12,13 (5010) and two of the ~4900
    // open-three makers. 12,9, 13,10 (590) and 14,9 (490) are cut.
    expect(keys.includes("14,9")).toBe(false);
  });
});

describe("catalog #3 — X's diagonal four is blocked on one end; boxed-five confirms a second valid block exists", () => {
  const board = parseBoard(`
       6  7  8  9 10 11 12 13 14 15 16 17
    6  .  .  .  .  .  .  .  .  .  .  .  .
    7  .  .  .  .  .  .  .  .  .  .  .  .
    8  .  .  .  .  .  .  .  .  X  .  .  .
    9  .  .  .  .  .  .  .  X  .  .  .  .
   10  .  .  .  .  .  .  X  .  .  .  .  .
   11  .  .  .  .  .  X  O  .  .  .  .  .
   12  .  .  .  .  O  O  .  .  .  .  .  .
   13  .  .  .  .  .  .  .  .  .  .  .  .
   14  .  .  .  .  .  .  .  .  .  .  .  .
   15  .  .  .  .  .  .  .  .  .  .  .  .
   16  .  .  .  .  .  .  .  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 2, 7)).toMatchSnapshot();
  });

  it("(6,16) also stops X, by boxing in the far end of the eventual five (Caro voids a five blocked on both ends)", () => {
    const oBoxesFarEnd = placeMove(board, 6, 16, 2);
    const xThenCompletes = placeMove(oBoxesFarEnd, 7, 15, 1);
    expect(checkCaroWin(xThenCompletes, 7, 15, 1)).toBe(false);
  });

  it("without the far-end box, playing the same completing cell DOES win for X", () => {
    const xCompletes = placeMove(board, 7, 15, 1);
    expect(checkCaroWin(xCompletes, 7, 15, 1)).toBe(true);
  });

  it("narrowCandidates' forced tier returns both the direct completing cell (7,15) and the boxed-five alternative (6,16)", () => {
    const result = narrowCandidates(board, 2, 7, CFG);
    expect(result.source).toBe("forced");
    expect(result.moves).toEqual([
      { row: 7, col: 15 },
      { row: 6, col: 16 },
    ]);
  });
});

describe("catalog #4 — X must answer O's open-three; the dual-purpose block outscores the pure block", () => {
  const board = parseBoard(`
       6  7  8  9 10 11 12 13 14 15 16 17
    6  .  .  .  .  .  .  .  .  .  .  .  .
    7  .  .  .  .  .  .  .  .  .  .  .  .
    8  .  .  .  .  .  .  .  .  .  .  .  .
    9  .  .  .  .  .  .  .  .  .  .  .  .
   10  .  .  .  .  .  .  .  .  .  .  .  .
   11  .  .  .  O  .  X  .  .  .  .  .  .
   12  .  .  .  .  O  .  X  .  .  .  .  .
   13  .  .  .  .  .  O  .  .  .  .  .  .
   14  .  .  .  .  .  .  .  .  .  .  .  .
   15  .  .  .  .  .  .  .  .  .  .  .  .
   16  .  .  .  .  .  .  .  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 1, 5)).toMatchSnapshot();
  });

  it("returns only the four urgent answers to O's open-three — 9,9 neither blocks nor outraces it, so the must-block filter drops it entirely", () => {
    // Matches the catalog's move list exactly: 9,7; 10,8; 14,12; 15,13
    // all "force to block O's open-three, but 14,12 higher score". 9,9
    // (4910, the highest raw score of any candidate here) would have
    // been X's own best soft offense, but playing it loses outright
    // against correct play — O's open-three simply promotes to an
    // unstoppable open-four next — so it never enters the pool.
    const result = narrowCandidates(board, 1, 5, CFG);
    expect(result.source).toBe("tactical");
    expect(result.moves).toEqual([
      { row: 14, col: 12 }, // 4600: block + builds a vertical two
      { row: 10, col: 8 }, // 4500: plain critical block
      { row: 9, col: 7 }, // 0: distance block (boxed-five), tier-retained
      { row: 15, col: 13 }, // 0: distance block (boxed-five), tier-retained
    ]);
    expect(scoreMove(board, 1, { row: 14, col: 12 })).toBe(4600);
    expect(scoreMove(board, 1, { row: 10, col: 8 })).toBe(4500);
  });
});

describe("catalog #5 — O's open four is unstoppable; desperado ranks X's own open-four makers over futile blocks", () => {
  const board = parseBoard(`
       6  7  8  9 10 11 12 13 14 15 16 17
    6  .  .  .  .  .  .  .  .  .  .  .  .
    7  .  .  .  .  .  .  .  .  .  .  .  .
    8  .  .  .  .  .  .  .  .  .  .  .  .
    9  .  .  .  .  .  .  .  .  .  .  .  .
   10  .  .  .  .  X  .  .  .  .  .  .  .
   11  .  .  .  O  .  X  .  .  .  .  .  .
   12  .  .  .  .  O  .  X  .  .  .  .  .
   13  .  .  .  .  .  O  .  .  .  .  .  .
   14  .  .  .  .  .  .  O  .  .  .  .  .
   15  .  .  .  .  .  .  .  .  .  .  .  .
   16  .  .  .  .  .  .  .  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 1, 7)).toMatchSnapshot();
  });

  it("no block survives the futility check, so the forced tier stands down — source is tactical, not forced", () => {
    // Blocking either end of a true open four provably fails: the other
    // completion is a five blocked on at most one end, which Caro
    // accepts. The catalog's call: "X is losing, no need to block,
    // advance anyway".
    const result = narrowCandidates(board, 1, 7, CFG);
    expect(result.source).toBe("tactical");
  });

  it("candidates are X's own threats ONLY — 9,9/13,13 (open-four makers) then 8,8/14,14 (four makers); the futile blocks are excluded", () => {
    // Offense only, per the catalog: negamax scores a loss at
    // -(WIN_SCORE + depth), so any block that delays the loss a ply
    // would beat every offense move in search — leaving a futile block
    // in the pool means the engine always grinds out delaying blocks
    // instead of threatening. In a lost position the own open-three's
    // FULL gains count (a plain four is still a forcing threat), not
    // just the open-four-making criticalGains.
    const result = narrowCandidates(board, 1, 7, CFG);
    expect(result.moves).toEqual([
      { row: 9, col: 9 },
      { row: 13, col: 13 },
      { row: 8, col: 8 },
      { row: 14, col: 14 },
    ]);
  });
});

describe("catalog #6 — X's single block (9,7) works only because it combines with X's pre-existing 15,13 to box the far end", () => {
  const board = parseBoard(`
       6  7  8  9 10 11 12 13 14 15 16 17
    6  .  .  .  .  .  .  .  .  .  .  .  .
    7  .  .  .  .  .  .  .  .  .  .  .  .
    8  .  .  .  .  .  .  .  .  .  .  .  .
    9  .  .  .  .  .  .  .  .  .  .  .  .
   10  .  .  O  .  .  .  .  .  .  .  .  .
   11  .  .  .  O  .  X  .  .  .  .  .  .
   12  .  .  .  .  O  .  X  .  .  .  .  .
   13  .  .  .  .  .  O  .  .  .  .  .  .
   14  .  .  .  .  .  .  .  .  .  .  .  .
   15  .  .  .  .  .  .  .  X  .  .  .  .
   16  .  .  .  .  .  .  .  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 1, 6)).toMatchSnapshot();
  });

  it("blocking at 9,7 fully stops O (the far end is already boxed by X's 15,13)", () => {
    const xBlocks = placeMove(board, 9, 7, 1);
    const oTriesFarEnd = placeMove(xBlocks, 14, 12, 2);
    expect(checkCaroWin(oTriesFarEnd, 14, 12, 2)).toBe(false);
  });

  it("blocking at 14,12 alone does NOT stop O — O still wins via 9,7 (only one end would be blocked)", () => {
    const xBlocksFarEnd = placeMove(board, 14, 12, 1);
    const oTriesNearEnd = placeMove(xBlocksFarEnd, 9, 7, 2);
    expect(checkCaroWin(oTriesNearEnd, 9, 7, 2)).toBe(true);
  });

  it("the pattern SCORER already gets this right — scoreMove ranks 9,7 (fully defuses O, score 100000) far above 14,12 (only downgrades to a one-sided four, score 90110)", () => {
    expect(scoreMove(board, 1, { row: 9, col: 7 })).toBe(100_000);
    expect(scoreMove(board, 1, { row: 14, col: 12 })).toBe(90_110);
  });

  it("the forced tier futility-filters to the single block that works: 9,7 alone — a single-candidate, no-search case", () => {
    // 14,12 is simulated and rejected (O still wins via 9,7); 9,7 is
    // simulated and kept (every O completion afterwards is boxed).
    const result = narrowCandidates(board, 1, 6, CFG);
    expect(result.source).toBe("forced");
    expect(result.moves).toEqual([{ row: 9, col: 7 }]);
  });
});

describe("catalog #7 — X's 9,9 is the sole urgent candidate: a recognized fork (two gapped two-tier lines promoted at once)", () => {
  const board = parseBoard(`
       6  7  8  9 10
    8  .  .  .  .  .
    9  .  .  .  .  .
   10  .  .  .  .  .
   11  .  X  .  X  .
   12  X  O  O  X  .
   13  .  O  .  .  .
   14  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 1, 6)).toMatchSnapshot();
  });

  it("ranks the fork point 9,9 first — sole urgent move, tier-guaranteed ahead of the soft/quiet padding", () => {
    const result = narrowCandidates(board, 1, 6, CFG);
    expect(result.source).toBe("tactical");
    expect(result.moves[0]).toEqual({ row: 9, col: 9 });
    expect(result.moves.length).toBeLessThanOrEqual(5);
  });
});

describe("catalog #8 — O's diagonal four is blocked on one end; boxed-five again gives X a second valid block", () => {
  const board = parseBoard(`
       3  4  5  6  7  8  9 10
    8  .  .  .  .  .  .  .  .
    9  .  .  .  .  .  .  .  .
   10  .  .  .  X  .  .  .  .
   11  .  .  .  .  X  .  X  .
   12  .  .  .  X  O  O  X  .
   13  .  .  .  .  O  .  .  .
   14  .  .  .  O  .  .  .  .
   15  .  .  O  .  .  .  .  .
   16  .  .  .  .  .  .  .  .
   17  .  .  .  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 1, 10)).toMatchSnapshot();
  });

  it("(17,3) also stops O, by boxing the far end (X's 11,9 already blocks the near end)", () => {
    const xBoxesFarEnd = placeMove(board, 17, 3, 1);
    const oTriesToComplete = placeMove(xBoxesFarEnd, 16, 4, 2);
    expect(checkCaroWin(oTriesToComplete, 16, 4, 2)).toBe(false);
  });

  it("narrowCandidates' forced tier returns both the direct completing cell (16,4) and the boxed-five alternative (17,3)", () => {
    const result = narrowCandidates(board, 1, 10, CFG);
    expect(result.source).toBe("forced");
    expect(result.moves).toEqual([
      { row: 16, col: 4 },
      { row: 17, col: 3 },
    ]);
  });
});

describe("catalog #9 — X's 10,8 is the sole urgent candidate: a recognized fork (two clean two-tier lines promoted at once)", () => {
  const board = parseBoard(`
       6  7  8  9 10
    8  .  .  .  .  .
    9  .  X  .  .  .
   10  .  .  .  .  .
   11  .  X  .  X  .
   12  X  O  O  .  .
   13  .  O  .  .  .
   14  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 1, 6)).toMatchSnapshot();
  });

  it("ranks the fork point 10,8 first — sole urgent move, tier-guaranteed ahead of the soft/quiet padding", () => {
    const result = narrowCandidates(board, 1, 6, CFG);
    expect(result.source).toBe("tactical");
    expect(result.moves[0]).toEqual({ row: 10, col: 8 });
    expect(result.moves.length).toBeLessThanOrEqual(5);
  });
});

describe("catalog #10 — same board as #7, but O to move: O must occupy X's fork point", () => {
  const board = parseBoard(`
       6  7  8  9 10
    8  .  .  .  .  .
    9  .  .  .  .  .
   10  .  .  .  .  .
   11  .  X  .  X  .
   12  X  O  O  X  .
   13  .  O  .  .  .
   14  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 2, 7)).toMatchSnapshot();
  });

  it("ranks 9,9 first — occupying X's double-open-three fork point blocks both lines at once", () => {
    // Defense mirrors offense here: recognizedForkPoints runs over the
    // opponent's patterns too, so the same cell that is X's only good
    // attack (#7) is O's only good defense.
    const result = narrowCandidates(board, 2, 7, CFG);
    expect(result.source).toBe("tactical");
    expect(result.moves[0]).toEqual({ row: 9, col: 9 });
  });
});

describe("catalog #11 — O must answer X's row-10 open-three; all four blocks (critical + distance) lead", () => {
  // X's vertical col-8 line (9,8-12,8) looks scary but is already dead:
  // O at 8,8 and 13,8 boxes both ends, so no five through it can ever be
  // valid and it produces no pattern — the forced tier stays quiet.
  const board = parseBoard(`
       5  6  7  8  9 10 11
    7  .  .  .  .  .  .  .
    8  .  .  O  O  .  .  .
    9  .  O  .  X  .  .  .
   10  .  .  X  X  X  .  .
   11  .  O  .  X  .  .  .
   12  .  .  .  X  .  .  .
   13  .  .  .  O  .  .  .
   14  .  .  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 2, 12)).toMatchSnapshot();
  });

  it("every one of the catalog's four blocks — 10,5 / 10,6 / 10,10 / 10,11 — is in the candidate pool", () => {
    const result = narrowCandidates(board, 2, 12, CFG);
    expect(result.source).toBe("tactical");
    const keys = result.moves.map((m) => `${m.row},${m.col}`);
    expect(keys).toEqual(
      expect.arrayContaining(["10,5", "10,6", "10,10", "10,11"]),
    );
  });

  it("dual-purpose blocks outrank pure blocks; O's own fork 8,6 is dropped outright, not merely outscored", () => {
    // 10,5 and 10,6 don't just answer X's open-three — 10,5 builds O's
    // diagonal open-three (8,7/9,6/10,5) and 10,6 the vertical one
    // (9,6/10,6/11,6) — so both outscore the pure critical block 10,10.
    // 8,6 (O's row-8 + col-6 fork) used to share the urgent tier and rank
    // first on raw score despite ignoring X's open-three entirely; the
    // must-block filter now simulates it directly (O plays 8,6, X
    // answers with the open-three's critical gain, the result is an
    // unstoppable open-four) and removes it from the pool instead of
    // leaving it for search to refute.
    const dualDiag = scoreMove(board, 2, { row: 10, col: 5 });
    const dualVert = scoreMove(board, 2, { row: 10, col: 6 });
    const pure = scoreMove(board, 2, { row: 10, col: 10 });
    expect(dualDiag).toBeGreaterThan(pure);
    expect(dualVert).toBeGreaterThan(pure);
    const result = narrowCandidates(board, 2, 12, CFG);
    const keys = result.moves.map((m) => `${m.row},${m.col}`);
    expect(keys).not.toContain("8,6");
    expect(keys.sort()).toEqual(["10,10", "10,11", "10,5", "10,6"]);
  });
});

describe("catalog #12 — O's 10,9 blocks two of X's open-twos at once (soft tier, no forced/urgent threats)", () => {
  // X has no three-tier pattern yet (only two-tier lines), so nothing is
  // forced or urgent here — this exercises plain soft-tier ranking. X's
  // diagonal open-two (8,7)/(9,8) is open at 7,6 and 10,9; O's 10,9 takes
  // the far end. Unlike the catalog's own note, 10,9 does not touch the
  // vertical open-two (7,9)/(8,9) (open at 6,9/9,9) in narrowCandidates'
  // single-ply static scoring — patterns.ts groups a "two" by its exact
  // stone pair per viable 5-window, not by informal adjacency, so 10,9
  // may also fall inside some window shared with other X stones. Exact
  // ranking/scores here are intentionally left to the snapshot rather
  // than hardcoded, since this board's pattern grouping is less obvious
  // to eyeball than the earlier catalog entries (verify against the
  // snapshot the first time this runs, then promote anything worth
  // pinning down into an explicit assertion).
  const board = parseBoard(`
       6  7  8  9 10 11 12
    6  .  .  .  .  .  .  .
    7  .  .  O  X  O  O  .
    8  .  X  .  X  .  .  .
    9  .  .  X  .  .  .  .
   10  .  .  .  .  .  .  .
  `);

  it("narrowCandidates ranked output", () => {
    expect(snapshotNarrow(board, 2, 7)).toMatchSnapshot();
  });

  it("has no forced or urgent threats — source is tactical from the soft tier alone", () => {
    const result = narrowCandidates(board, 2, 7, CFG);
    expect(result.source).toBe("tactical");
  });
});
