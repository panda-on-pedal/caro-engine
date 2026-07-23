export enum TTFlag {
  Exact = 0,
  Lower = 1,
  Upper = 2,
}

export interface TTEntry {
  /** Remaining depth this result was searched to. */
  depth: number;
  /** Ply-adjusted score (see search mate handling). */
  score: number;
  flag: TTFlag;
  /** Best move found here, or -1/-1 for an eval-only/terminal node. */
  bestRow: number;
  bestCol: number;
}

/** In-memory transposition table. Depth-preferred replacement; tracks entries
 *  changed since the last `takeDirty` so a persistence layer can flush deltas. */
export class TranspositionTable {
  private readonly map = new Map<bigint, TTEntry>();
  private dirty = new Set<bigint>();

  probe(hash: bigint): TTEntry | undefined {
    return this.map.get(hash);
  }

  store(hash: bigint, entry: TTEntry): void {
    const existing = this.map.get(hash);
    if (existing !== undefined && existing.depth >= entry.depth) {
      return;
    }
    this.map.set(hash, entry);
    this.dirty.add(hash);
  }

  seed(rows: Iterable<[bigint, TTEntry]>): void {
    for (const [hash, entry] of rows) {
      this.map.set(hash, entry);
    }
  }

  takeDirty(): Array<[bigint, TTEntry]> {
    const out: Array<[bigint, TTEntry]> = [];
    for (const hash of this.dirty) {
      const entry = this.map.get(hash);
      if (entry !== undefined) {
        out.push([hash, entry]);
      }
    }
    this.dirty = new Set();
    return out;
  }

  get size(): number {
    return this.map.size;
  }
}
