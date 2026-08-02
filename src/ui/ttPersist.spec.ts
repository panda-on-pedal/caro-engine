// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import "fake-indexeddb/auto";
import { loadSlice, flushSlice, evictSlice } from "./ttPersist.ts";
import { TTFlag, type TTEntry } from "../engine/transposition/transposition.ts";

const e = (depth: number): TTEntry => ({
  depth,
  score: 42,
  flag: TTFlag.Exact,
  bestRow: 3,
  bestCol: 4,
});

describe("ttPersist", () => {
  it("round-trips bigint-hashed entries through IndexedDB", async () => {
    await flushSlice("KEY_A", [[0x1234abcdn, e(5)]]);
    expect(await loadSlice("KEY_A")).toEqual([[0x1234abcdn, e(5)]]);
  });

  it("keeps slices isolated per key and evicts only the named key", async () => {
    await flushSlice("KEY_A", [[1n, e(1)]]);
    await flushSlice("KEY_B", [[2n, e(2)]]);
    await evictSlice("KEY_A");
    expect(await loadSlice("KEY_A")).toEqual([]);
    expect(await loadSlice("KEY_B")).toEqual([[2n, e(2)]]);
  });
});
