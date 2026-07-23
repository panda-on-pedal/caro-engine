import { search, type SearchConfig } from "./search.ts";
import {
  TranspositionTable,
  type TTEntry,
} from "../transposition/transposition.ts";
import { parseBoard } from "../test-helpers/parse-board.ts";
import { ALL_FORK_PATTERN_NAMES } from "./narrow.ts";

const baseConfig = (tt?: TranspositionTable): SearchConfig => ({
  maxDepth: 4,
  recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
  rootScoreJitter: 0,
  tt,
});

describe("negamax with a transposition table", () => {
  const board = parseBoard(`
    ....................
    .....XX.............
    ......OO............
    ....................
  `);

  it("returns the identical move and score as a cold search", () => {
    const cold = search(board, 1, baseConfig());
    const warm = search(board, 1, baseConfig(new TranspositionTable()));
    expect(warm.move).toEqual(cold.move);
    expect(warm.score).toBe(cold.score);
  });

  it("visits fewer nodes when the TT is pre-warmed by a first search", () => {
    const tt = new TranspositionTable();
    const first = search(board, 1, baseConfig(tt));
    const second = search(board, 1, baseConfig(tt));
    expect(second.move).toEqual(first.move);
    expect(second.score).toBe(first.score);
    expect(second.nodesVisited).toBeLessThan(first.nodesVisited);
  });

  it("fires onDepthComplete once per completed depth with drained dirty entries", () => {
    const board = parseBoard(`
      ....................
      .....XX.............
      ......OO............
      ....................
    `);
    const tt = new TranspositionTable();
    const depths: number[] = [];
    let totalEntries = 0;
    search(board, 1, {
      maxDepth: 3,
      recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
      rootScoreJitter: 0,
      tt,
      onDepthComplete: (depth: number, dirty: Array<[bigint, TTEntry]>) => {
        depths.push(depth);
        totalEntries += dirty.length;
      },
    });
    expect(depths).toEqual([1, 2, 3]);
    expect(totalEntries).toBeGreaterThan(0);
  });
});
