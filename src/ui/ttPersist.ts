// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { Dexie, type Table } from "dexie";
import { type TTEntry } from "../engine/transposition/transposition.ts";

interface TTRow {
  key: string; // experience canonical key (slice namespace)
  hash: string; // zobrist bigint as lowercase hex
  depth: number;
  score: number;
  flag: number;
  bestRow: number;
  bestCol: number;
}

class TTDatabase extends Dexie {
  tt!: Table<TTRow, [string, string]>;
  constructor() {
    super("caro-engine-tt-v1");
    this.version(1).stores({ tt: "[key+hash], key" });
  }
}

const db = new TTDatabase();

export async function loadSlice(key: string): Promise<Array<[bigint, TTEntry]>> {
  const rows = await db.tt.where("key").equals(key).toArray();
  return rows.map(r => [
    BigInt("0x" + r.hash),
    {
      depth: r.depth,
      score: r.score,
      flag: r.flag,
      bestRow: r.bestRow,
      bestCol: r.bestCol,
    },
  ]);
}

export async function flushSlice(key: string, dirty: Array<[bigint, TTEntry]>): Promise<void> {
  if (dirty.length === 0) return;
  const rows: TTRow[] = dirty.map(([hash, entry]) => ({
    key,
    hash: hash.toString(16),
    depth: entry.depth,
    score: entry.score,
    flag: entry.flag,
    bestRow: entry.bestRow,
    bestCol: entry.bestCol,
  }));
  await db.tt.bulkPut(rows);
}

export async function evictSlice(key: string): Promise<void> {
  await db.tt.where("key").equals(key).delete();
}
