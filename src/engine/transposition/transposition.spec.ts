import { TranspositionTable, TTFlag, type TTEntry } from "./transposition.ts";

const entry = (depth: number, score = 0): TTEntry => ({
  depth,
  score,
  flag: TTFlag.Exact,
  bestRow: 1,
  bestCol: 2,
});

describe("TranspositionTable", () => {
  it("keeps the deeper entry on store (depth-preferred)", () => {
    const tt = new TranspositionTable();
    tt.store(10n, entry(4));
    tt.store(10n, entry(2)); // shallower — ignored
    expect(tt.probe(10n)?.depth).toBe(4);
    tt.store(10n, entry(6)); // deeper — wins
    expect(tt.probe(10n)?.depth).toBe(6);
  });

  it("returns undefined for a miss", () => {
    expect(new TranspositionTable().probe(99n)).toBeUndefined();
  });

  it("seed does not dirty; store does; takeDirty drains", () => {
    const tt = new TranspositionTable();
    tt.seed([[1n, entry(3)]]);
    expect(tt.takeDirty()).toHaveLength(0);
    tt.store(2n, entry(3));
    expect(tt.takeDirty()).toEqual([[2n, entry(3)]]);
    expect(tt.takeDirty()).toHaveLength(0);
  });
});
