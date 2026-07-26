import { partitionCandidates, aggregateParallelResults } from "./parallelSearch.ts";
import type { SearchResult } from "../engine/search/search.ts";

describe("partitionCandidates", () => {
  it("round-robins into k non-empty slices", () => {
    const cands = [0, 1, 2, 3, 4].map(n => ({ row: 0, col: n }));
    const parts = partitionCandidates(cands, 2);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual([{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 4 }]);
    expect(parts[1]).toEqual([{ row: 0, col: 1 }, { row: 0, col: 3 }]);
  });

  it("never creates more slices than candidates", () => {
    const cands = [{ row: 0, col: 0 }];
    expect(partitionCandidates(cands, 8)).toHaveLength(1);
  });
});

describe("aggregateParallelResults", () => {
  const mk = (col: number, score: number, nodes: number): SearchResult => ({
    move: { row: 0, col },
    score,
    depth: 6,
    principalVariation: [{ row: 0, col }],
    nodesVisited: nodes,
  });

  it("picks the highest true score and sums nodes", () => {
    const agg = aggregateParallelResults([mk(0, 100, 10), mk(1, 250, 20), mk(2, 90, 5)]);
    expect(agg.move).toEqual({ row: 0, col: 1 });
    expect(agg.score).toBe(250);
    expect(agg.nodesVisited).toBe(35);
  });

  it("throws on empty input", () => {
    expect(() => aggregateParallelResults([])).toThrow();
  });
});
