# Incremental Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hard-mode search reach useful depth inside its time budget by caching pattern instances and updating them with a 4-line rebuild on place/undo, instead of full-board `findPatterns` at every node.

**Architecture:** Keep `findPatterns(board, player)` as the pure full-scan correctness oracle. Add a `PatternStore` that owns a mutable board copy, cached patterns for both players, and a place/undo stack. After each place, drop patterns on the four lines through the move and rescan only those lines (same functional classification as today). Search, narrow, evaluate, and rankMoves read patterns from the store during search; unit tests still call `findPatterns` directly.

**Tech Stack:** TypeScript (`nodenext`, `.ts` import extensions), Jest + `parseBoard`, existing `patterns.ts` / `narrow.ts` / `rankMoves.ts` / `evaluate.ts` / `search.ts`. No new dependencies.

## Global Constraints

- Implement in the main `caro-engine` checkout on a dedicated feature branch (suggested name: `feat/incremental-patterns`), branched from the current mainline that already contains pattern-driven search / top-K (`master` or whichever branch is up to date). Paths below are relative to the repo root (`caro-engine/`).
- Do **not** implement this plan in `.claude/worktrees/pattern-driven-search` or any other git worktree — use the feature branch only.
- Before Task 1: create and check out the feature branch if it does not already exist (`git checkout -b feat/incremental-patterns`).
- Dependency direction: `engine → search → narrow/rankMoves/evaluate → patternStore → patterns → rules → board`. `patternStore` may import `patterns` and `board`; it must not import `search` or `engine`.
- `findPatterns` remains a pure full-board scan and the oracle for equality tests. Do **not** make it guess incremental vs full from `(board, player)` alone.
- Incremental algorithm for this plan is **4-line rebuild**, not fine-grained per-window deltas:
  1. Place stone at `(r, c)`.
  2. For each of the 4 directions, remove cached patterns (both players) that live on the line through `(r, c)`.
  3. Rescan that line for both players with the same classification rules as `findPatterns`.
  4. Merge results back into the cache.
  5. Undo restores board cell + previous pattern lists from a stack frame.
- Pattern identity for “on this line”: same `direction` and same line key as the move:
  - `[0,1]` → `row`
  - `[1,0]` → `col`
  - `[1,1]` → `row - col`
  - `[1,-1]` → `row + col`
  A pattern is on the line if any of its `cells` matches that key (gains-only patterns do not exist in this codebase).
- Public `GameState` / `placeMove` immutability for the UI stays unchanged. Mutation is internal to search via `PatternStore`.
- Out of scope: Phase B VCF/VCT, Phase C1 TT, typed-array boards, opening book, score-table tuning, changing difficulty depths (2/4/6) or default budgets except where a test needs a higher budget to measure speedup.
- Also in this plan (small, high leverage): iterative deepening must **not** replace a complete depth `D-1` result with a partial depth `D` root iteration when the deadline fires mid-root.

## File structure

| Path | Role |
|------|------|
| `src/engine/patterns.ts` | Keep `findPatterns` as oracle; extract line-scoped scan used by both full scan and store updates. |
| `src/engine/patternStore.ts` | Mutable board + cached patterns + place/undo + 4-line rebuild. |
| `src/engine/patternStore.spec.ts` | Equality vs `findPatterns`, place/undo round-trips, catalog boards. |
| `src/engine/evaluate.ts` | Add `evaluateFromPatterns(own, opp, playerToMove)`; `evaluate` becomes a thin full-scan wrapper. |
| `src/engine/narrow.ts` | Accept optional precomputed patterns; use store board for trial places where needed. |
| `src/engine/rankMoves.ts` | Score from store (or passed pattern baselines + trial place on store). |
| `src/engine/search.ts` | Own a `PatternStore` for the search; place/undo instead of `placeMove` copies; fix partial-ID acceptance. |
| `src/engine/engine.ts` | No API change required; comments may note incremental search. |

```
chooseMove
  → search(board, player, config)
       PatternStore.fromBoard(board)          // 1× full findPatterns × 2 players
       narrowCandidates(store, ...)           // read cache
       negamax:
         store.place(move, player)
         recurse / evaluateFromPatterns(store)
         store.undo()
```

---

### Task 1: Line key helpers + line-scoped pattern scan

**Files:**
- Modify: `src/engine/patterns.ts`
- Modify: `src/engine/patterns.spec.ts`

**Interfaces:**
- Consumes: existing window/classification helpers inside `patterns.ts`
- Produces:
  ```ts
  export type Direction = readonly [number, number]; // one of the 4 DIRECTIONS

  /** Line identity for direction through a cell. */
  export function lineKey(row: number, col: number, direction: Direction): number;

  /**
   * Patterns for `player` whose stones lie on the single line through
   * `(anchorRow, anchorCol)` in `direction`. Same classification as
   * findPatterns, but only windows on that line are considered.
   */
  export function findPatternsOnLine(
    board: Board,
    player: Player,
    anchorRow: number,
    anchorCol: number,
    direction: Direction,
  ): PatternInstance[];

  // findPatterns(board, player) must equal the concatenation of
  // findPatternsOnLine over every distinct line that can hold a stone
  // (or simply: keep current full scan implementation, but implement it
  // by calling an internal shared classifier so line scan and full scan
  // cannot drift). Preferred: refactor findPatterns to iterate lines /
  // windows via shared helpers; public results must stay identical.
  ```

- [ ] **Step 1: Write the failing tests**

Add to `patterns.spec.ts`:

```ts
import {
  findPatterns,
  findPatternsOnLine,
  lineKey,
} from "./patterns.ts";

describe("lineKey", () => {
  it("groups cells on the same diagonal", () => {
    expect(lineKey(3, 1, [1, 1])).toBe(lineKey(5, 3, [1, 1]));
    expect(lineKey(3, 1, [1, 1])).not.toBe(lineKey(3, 2, [1, 1]));
  });
});

describe("findPatternsOnLine vs findPatterns", () => {
  it("horizontal line patterns are a subset of the full scan", () => {
    const board = parseBoard(`
      .......
      .XX.X..
      ..O....
      .......
    `);
    const onLine = findPatternsOnLine(board, 1, 1, 1, [0, 1]);
    const full = findPatterns(board, 1);
    for (const p of onLine) {
      expect(p.direction).toEqual([0, 1]);
      expect(
        full.some(
          (f) =>
            f.type === p.type &&
            f.cells.map((c) => `${c.row},${c.col}`).sort().join("|") ===
              p.cells.map((c) => `${c.row},${c.col}`).sort().join("|"),
        ),
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/patterns.spec.ts -t "lineKey|findPatternsOnLine"`
Expected: FAIL — `lineKey` / `findPatternsOnLine` not exported.

- [ ] **Step 3: Implement line helpers**

In `patterns.ts`:

1. Export `lineKey(row, col, [dRow, dCol])`:
   - `[0,1]` → `row`
   - `[1,0]` → `col`
   - `[1,1]` → `row - col`
   - `[1,-1]` → `row + col`
2. Implement `findPatternsOnLine` by restricting `viableWindowsInDirection` (or equivalent) to windows that include a cell on the anchor line — simplest correct approach: run the existing per-direction finders but only start windows whose cells all share `lineKey === lineKey(anchorRow, anchorCol, direction)`.
3. Keep `findPatterns` public behavior unchanged (existing `patterns.spec.ts` must still pass). Prefer implementing full scan as “all lines” or keep the current nested loops if line scan is a filtered variant of the same window loop.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/engine/patterns.spec.ts`
Expected: PASS (old + new).

- [ ] **Step 5: Commit**

```bash
git add src/engine/patterns.ts src/engine/patterns.spec.ts
git commit -m "$(cat <<'EOF'
feat(engine): add line-scoped pattern scan helpers

EOF
)"
```

---

### Task 2: `PatternStore` — full build, place, undo, 4-line rebuild

**Files:**
- Create: `src/engine/patternStore.ts`
- Create: `src/engine/patternStore.spec.ts`

**Interfaces:**
- Consumes: `Board`, `Player`, `place`-style mutation, `findPatterns`, `findPatternsOnLine`, `lineKey`, `DIRECTIONS` (export directions from `patterns.ts` if not already public — add `export const PATTERN_DIRECTIONS` mirroring the 4 dirs)
- Produces:
  ```ts
  export class PatternStore {
    /** Deep-copies board; runs findPatterns for players 1 and 2 once. */
    static fromBoard(board: Board): PatternStore;

    /** Mutable view used by search / narrow trial logic. */
    readonly board: Board;

    patterns(player: Player): readonly PatternInstance[];

    /**
     * Place `player` at move (must be empty). Updates board + caches via
     * 4-line rebuild. Pushes an undo frame.
     */
    place(move: Move, player: Player): void;

    /** Restore board cell and pattern caches from the last place. */
    undo(): void;

    /** Current stack depth (for tests). */
    get depth(): number;
  }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { PatternStore } from "./patternStore.ts";
import { findPatterns } from "./patterns.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";
import { placeMove } from "./board.ts";

function sortedPatterns(board: Board, player: 1 | 2) {
  return findPatterns(board, player)
    .map((p) => ({
      type: p.type,
      dir: `${p.direction[0]},${p.direction[1]}`,
      cells: p.cells.map((c) => `${c.row},${c.col}`).sort().join("|"),
      gains: p.gains.map((c) => `${c.row},${c.col}`).sort().join("|"),
      critical: p.criticalGains.map((c) => `${c.row},${c.col}`).sort().join("|"),
    }))
    .sort((a, b) =>
      `${a.type}|${a.dir}|${a.cells}`.localeCompare(`${b.type}|${b.dir}|${b.cells}`),
    );
}

describe("PatternStore", () => {
  it("fromBoard matches findPatterns for both players", () => {
    const board = parseBoard(`
      .....
      .XX..
      ..O..
      .....
    `);
    const store = PatternStore.fromBoard(board);
    expect(sortedPatterns(store.board as never, 1)).toEqual(sortedPatterns(board, 1));
    // Compare store.patterns(1) via the same sort shape as findPatterns(board, 1)
    expect(
      store.patterns(1).map(/* same shape */),
    ).toEqual(sortedPatterns(board, 1));
  });

  it("place then patterns match findPatterns on the placed board", () => {
    const board = parseBoard(`
      .....
      .XX..
      ..O..
      .....
    `);
    const store = PatternStore.fromBoard(board);
    store.place({ row: 1, col: 3 }, 1);
    const expected = placeMove(board, 1, 3, 1);
    expect(
      /* sorted store.patterns(1) */,
    ).toEqual(sortedPatterns(expected, 1));
    expect(
      /* sorted store.patterns(2) */,
    ).toEqual(sortedPatterns(expected, 2));
  });

  it("undo restores prior patterns and empty cell", () => {
    const board = parseBoard(`
      .....
      .XX..
      ..O..
      .....
    `);
    const store = PatternStore.fromBoard(board);
    const before1 = /* snapshot sorted patterns(1) */;
    store.place({ row: 1, col: 3 }, 1);
    store.undo();
    expect(store.board[1][3]).toBe(0);
    expect(/* sorted patterns(1) */).toEqual(before1);
    expect(store.depth).toBe(0);
  });

  it("matches findPatterns after a short place/undo sequence on a catalog-like board", () => {
    // Use catalog #4 fragment (open-three block position) from board-state-catalog
    // Place 2–3 legal moves alternating, after each place assert equality vs findPatterns.
  });
});
```

Fill the `/* ... */` placeholders with a shared `canonicalize(patterns)` helper in the spec file (do not leave them as comments in the real implementation).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/patternStore.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `PatternStore`**

```ts
// src/engine/patternStore.ts (shape)

type UndoFrame = {
  row: number;
  col: number;
  previousCell: Cell;
  patterns1: PatternInstance[];
  patterns2: PatternInstance[];
};

export class PatternStore {
  readonly board: Board;
  private patterns1: PatternInstance[];
  private patterns2: PatternInstance[];
  private stack: UndoFrame[] = [];

  static fromBoard(board: Board): PatternStore {
    const copy = board.map((r) => r.slice()) as Board;
    return new PatternStore(
      copy,
      findPatterns(copy, 1),
      findPatterns(copy, 2),
    );
  }

  patterns(player: Player): readonly PatternInstance[] {
    return player === 1 ? this.patterns1 : this.patterns2;
  }

  get depth(): number {
    return this.stack.length;
  }

  place(move: Move, player: Player): void {
    const { row, col } = move;
    if (this.board[row][col] !== 0) {
      throw new Error(`PatternStore.place: occupied (${row},${col})`);
    }
    this.stack.push({
      row,
      col,
      previousCell: 0,
      patterns1: this.patterns1,
      patterns2: this.patterns2,
    });
    this.board[row][col] = player;
    // Clone arrays we will mutate (stack holds prior references)
    this.patterns1 = this.patterns1.slice();
    this.patterns2 = this.patterns2.slice();
    this.rebuildLinesThrough(row, col);
  }

  undo(): void {
    const frame = this.stack.pop();
    if (!frame) throw new Error("PatternStore.undo: empty stack");
    this.board[frame.row][frame.col] = frame.previousCell;
    this.patterns1 = frame.patterns1;
    this.patterns2 = frame.patterns2;
  }

  private rebuildLinesThrough(row: number, col: number): void {
    for (const direction of PATTERN_DIRECTIONS) {
      const key = lineKey(row, col, direction);
      this.patterns1 = this.patterns1.filter(
        (p) =>
          !(
            p.direction[0] === direction[0] &&
            p.direction[1] === direction[1] &&
            p.cells.some((c) => lineKey(c.row, c.col, direction) === key)
          ),
      );
      this.patterns2 = this.patterns2.filter(
        (p) =>
          !(
            p.direction[0] === direction[0] &&
            p.direction[1] === direction[1] &&
            p.cells.some((c) => lineKey(c.row, c.col, direction) === key)
          ),
      );
      this.patterns1.push(
        ...findPatternsOnLine(this.board, 1, row, col, direction),
      );
      this.patterns2.push(
        ...findPatternsOnLine(this.board, 2, row, col, direction),
      );
    }
  }
}
```

Critical implementation note: undo frames must keep **immutable snapshots** of the pre-place pattern arrays (the `.slice()` of the array before mutation is enough if pattern objects are never mutated in place). Do not mutate `PatternInstance` fields after creation.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/engine/patternStore.spec.ts`
Expected: PASS.

If equality fails on open-three/open-two, the bug is almost always line filtering (window on the line but stones keyed wrong) or forgetting to rescan **both** players. Fix until `canonicalize(store.patterns(p)) === canonicalize(findPatterns(board, p))` after every place.

- [ ] **Step 5: Commit**

```bash
git add src/engine/patternStore.ts src/engine/patternStore.spec.ts src/engine/patterns.ts
git commit -m "$(cat <<'EOF'
feat(engine): add PatternStore with 4-line incremental rebuild

EOF
)"
```

---

### Task 3: Evaluate / narrow / rankMoves read cached patterns

**Files:**
- Modify: `src/engine/evaluate.ts`
- Modify: `src/engine/evaluate.spec.ts` (if needed — relative assertions still via `evaluate(board)`)
- Modify: `src/engine/narrow.ts`
- Modify: `src/engine/rankMoves.ts`
- Modify: `src/engine/narrow.spec.ts` / `src/engine/rankMoves.spec.ts` only if signatures require it

**Interfaces:**
- Consumes: `PatternStore` or `readonly PatternInstance[]`
- Produces:
  ```ts
  // evaluate.ts
  export function evaluateFromPatterns(
    moverPatterns: readonly PatternInstance[],
    opponentPatterns: readonly PatternInstance[],
    playerToMove: Player,
  ): number;

  export function evaluate(board: Board, playerToMove: Player): number;
  // evaluate = evaluateFromPatterns(findPatterns(...), findPatterns(...), ...)

  // narrow.ts — extend NarrowConfig or add overload:
  export interface NarrowConfig {
    // ...existing fields...
    /** When set, skip the two findPatterns calls at the start of narrowCandidates. */
    ownPatterns?: readonly PatternInstance[];
    oppPatterns?: readonly PatternInstance[];
  }

  // rankMoves.ts
  // selectTopMoves / scoreMoveFromBaseline: when baselines are passed in,
  // do not call findPatterns for "before". For "after", either:
  //   (preferred) accept PatternStore, store.place → read totals → store.undo
  //   or keep placeMove+findPatterns for after until Task 4 wires search
  //
  // For this task: add
  export function selectTopMovesFromStore(
    store: PatternStore,
    player: Player,
    moves: readonly Move[],
    k?: number,
  ): Move[];
  ```

- [ ] **Step 1: Write / extend failing tests**

In `rankMoves.spec.ts` (or `patternStore.spec.ts` integration):

```ts
it("selectTopMovesFromStore agrees with selectTopMoves on the same board", () => {
  const board = parseBoard(`/* catalog #2 or #4 fragment */`);
  const moves = [/* 4–6 legal candidates */];
  const store = PatternStore.fromBoard(board);
  const fromStore = selectTopMovesFromStore(store, 2, moves, 5);
  const fromBoard = selectTopMoves(board, 2, moves, 5);
  expect(fromStore.map((m) => `${m.row},${m.col}`)).toEqual(
    fromBoard.map((m) => `${m.row},${m.col}`),
  );
  expect(store.depth).toBe(0); // all trial places undone
});
```

In `narrow.spec.ts`, one case that passes `ownPatterns`/`oppPatterns` from `findPatterns` and expects identical `moves` to the default path.

- [ ] **Step 2: Run tests — expect FAIL** (new exports missing)

- [ ] **Step 3: Implement wiring**

1. Extract body of `evaluate` into `evaluateFromPatterns`.
2. At top of `narrowCandidates`, use `config.ownPatterns ?? findPatterns(...)` (same for opp).
3. Implement `selectTopMovesFromStore`:
   - `ownBefore = totalPatternScore(store.patterns(player))` etc.
   - for each move: `store.place(move, player)`; if win → +∞; else score from `store.patterns`; `store.undo()`.
4. Keep old `selectTopMoves(board, ...)` working for tests (may still full-scan).

- [ ] **Step 4: Run**

Run: `npm test -- src/engine/evaluate.spec.ts src/engine/rankMoves.spec.ts src/engine/narrow.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/evaluate.ts src/engine/narrow.ts src/engine/rankMoves.ts src/engine/*.spec.ts
git commit -m "$(cat <<'EOF'
feat(engine): let evaluate/narrow/rankMoves use cached patterns

EOF
)"
```

---

### Task 4: Search owns `PatternStore` + place/undo

**Files:**
- Modify: `src/engine/search.ts`
- Modify: `src/engine/narrow.ts` (call `selectTopMovesFromStore` when a store is provided)
- Modify: `src/engine/search.spec.ts`

**Interfaces:**
- Consumes: `PatternStore.fromBoard`, `store.place` / `store.undo`, `evaluateFromPatterns`, `narrowCandidates` with pattern fields
- Produces: same `SearchResult` / `search()` signatures (no public API break)

Thread a `PatternStore` through `negamax` instead of copying boards with `placeMove`:

```ts
// Inside negamax loop (conceptual)
store.place(move, player);
const isWin = checkCaroWin(store.board, move.row, move.col, player);
const isLose = !isWin && hasImmediateWin(store.board, otherPlayer(player));
// Prefer a hasImmediateWinFromPatterns(store.patterns(attacker)) helper
// to avoid findPatterns inside hasImmediateWin during search — Task 4a below.
const child = isWin || isLose ? ... : negamax(store, other, depth - 1, ...);
store.undo();
```

Root `search()`:

```ts
const store = PatternStore.fromBoard(board);
const narrowed = narrowCandidates(store.board, player, moveCount, {
  ...narrowConfig,
  ownPatterns: store.patterns(player),
  oppPatterns: store.patterns(otherPlayer(player)),
  store, // if you add store to NarrowConfig for top-K scoring
});
```

- [ ] **Step 1: Failing behavioral test**

Keep an existing tactical search test (must-block / win-in-1). Add:

```ts
it("search with PatternStore still finds the forced block", () => {
  // reuse an existing fixture from search.spec.ts that expects a unique block
  const result = search(board, player, { maxDepth: 4, timeBudgetMs: 5000 });
  expect(`${result.move.row},${result.move.col}`).toBe(expected);
});
```

This may already pass once wired; the real new test is performance-ish in Task 6. For Task 4, add a unit-level assertion that `nodesVisited` on a quiet midgame position is higher under the same budget than a baseline recorded comment — optional. Minimum: all `search.spec.ts` / `engine.spec.ts` stay green.

- [ ] **Step 2: Implement search threading**

Replace `const next = placeMove(board, ...)` with `store.place` / `store.undo` in the recursive path. Pass `store` into recursive `negamax`. At depth 0 use `evaluateFromPatterns(store.patterns(player), store.patterns(opponent), player)`.

Also update `hasImmediateWin` call sites used from search to prefer patterns from the store:

```ts
export function hasImmediateWinFromPatterns(
  board: Board,
  attacker: Player,
  attackerPatterns: readonly PatternInstance[],
): boolean {
  // same body as hasImmediateWin but iterate attackerPatterns instead of findPatterns
}
```

Keep `hasImmediateWin(board, attacker)` as `hasImmediateWinFromPatterns(board, attacker, findPatterns(board, attacker))` for tests.

For `survivingBlocks` / `opponentForcesWinAfter` inside `narrowCandidates`: when `config.store` is present, trial-place on the store and undo; otherwise keep `placeMove` + `findPatterns` for isolated unit tests.

- [ ] **Step 3: Run full engine tests**

Run: `npm test -- src/engine/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/engine/search.ts src/engine/narrow.ts src/engine/search.spec.ts
git commit -m "$(cat <<'EOF'
feat(engine): drive negamax through PatternStore place/undo

EOF
)"
```

---

### Task 5: Iterative deepening — discard partial root iterations

**Files:**
- Modify: `src/engine/search.ts` (`negamaxStrategy`)
- Modify: `src/engine/search.spec.ts`

**Why in this plan:** Incremental patterns make deeper iterations more likely; without this fix, a timeout mid-root at depth D still overwrites a complete D−1 answer (existing comment at the `bestNode = result` assignment).

**Interfaces:**
- Produces: `negamax` root loop returns whether every root candidate was examined (or `negamaxStrategy` tracks `examinedCount === moves.length` via a small return field).

- [ ] **Step 1: Failing test**

```ts
it("keeps the previous depth's move when a deeper iteration is partial", () => {
  // Inject a fake strategy-internal deadline by using a tiny timeBudgetMs
  // on a position with many root candidates so depth ≥ 2 often partial-completes.
  // Assert: either depthReached is the last fully completed depth, or
  // when logs are unavailable, expose SearchResult.partialDepth / use
  // a test-only hook.
  //
  // Practical approach: export a test helper or add to SearchResult:
  //   completedDepth: number  // last depth where all root moves finished
  // And set depth to completedDepth for the returned move.
});
```

Concrete API addition:

```ts
export interface SearchResult {
  move: Move;
  score: number;
  depth: number; // == last fully completed iterative depth
  principalVariation: Move[];
  nodesVisited: number;
}
```

Change `negamax` root handling to return `{ node, rootComplete: boolean }` or only assign `bestNode = result` when `examinedCount === moves.length` **or** when `result` is a forced win/loss short-circuit that examined at least one move and proved mate. If deadline breaks the root loop early, keep prior `bestNode`.

- [ ] **Step 2: Implement**

In `negamax`, when `isRootFrame` and deadline breaks, set a flag `rootIncomplete = true` on the returned node (extend `SearchNode` with optional `complete?: boolean`, default true for non-root).

In `negamaxStrategy`:

```ts
if (result.principalVariation.length === 0) break;
if (result.complete === false) {
  // keep bestNode from previous depth; stop deepening
  break;
}
bestNode = result;
depthReached = depth;
```

- [ ] **Step 3: Run** `npm test -- src/engine/search.spec.ts` — PASS

- [ ] **Step 4: Commit**

```bash
git add src/engine/search.ts src/engine/search.spec.ts
git commit -m "$(cat <<'EOF'
fix(engine): ignore partial iterative-deepening iterations

EOF
)"
```

---

### Task 6: Correctness stress + speed sanity check

**Files:**
- Modify: `src/engine/patternStore.spec.ts` (stress)
- Create (optional): `src/engine/patternStore.bench.spec.ts` **or** a single timed test gated lightly

- [ ] **Step 1: Property test — random place/undo vs oracle**

```ts
it("random walk of place/undo matches findPatterns", () => {
  const board = createEmptyBoard(20);
  // seed center stones
  board[10][10] = 1;
  board[10][11] = 2;
  const store = PatternStore.fromBoard(board);
  const rng = /* mulberry32 with fixed seed */;
  let player: Player = 1;
  for (let i = 0; i < 40; i += 1) {
    const candidates = findCandidateMoves(store.board);
    const move = candidates[Math.floor(rng() * candidates.length)];
    store.place(move, player);
    expect(canonicalize(store.patterns(1))).toEqual(
      canonicalize(findPatterns(store.board, 1)),
    );
    expect(canonicalize(store.patterns(2))).toEqual(
      canonicalize(findPatterns(store.board, 2)),
    );
    if (rng() < 0.3 && store.depth > 0) {
      store.undo();
      player = player === 1 ? 2 : 1; // careful: define undo policy — simpler: never random undo mid-loop; instead do place×N then undo×N
      // Prefer: N places, assert each time; then undo all N and assert back to start.
    }
    player = player === 1 ? 2 : 1;
  }
});
```

Prefer the simpler variant: 25 sequential places with assert-after-each, then 25 undos with assert-after-each.

- [ ] **Step 2: Speed sanity (soft)**

```ts
it("PatternStore place is faster than placeMove+findPatterns×2 on a busy board", () => {
  // Build a board with ~30 stones.
  // Warm up both paths.
  // Time 200 iterations of (place candidate + read patterns + undo) via store
  // vs (placeMove + findPatterns×2) without undo reuse.
  // Expect store path wall time < 50% of full-scan path (loose bound).
  // If flaky on CI, mark as a local/dev assertion with a higher bound or skip on CI env.
});
```

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manual hard-mode smoke**

Run a quick script or existing difficulty test with `difficulty: "hard"` on a midgame `parseBoard` and log `SearchResult.depth` / `nodesVisited` before vs after (note numbers in the commit message body). Success criterion: under the same `timeBudgetMs: 5000`, `depth` reached is typically higher than pre-change on the same fixture (document the fixture in the test name).

- [ ] **Step 5: Commit**

```bash
git add src/engine/patternStore.spec.ts
git commit -m "$(cat <<'EOF'
test(engine): stress incremental patterns against full-scan oracle

EOF
)"
```

---

## Self-review checklist

1. **Spec coverage (Phase C2):** incremental pattern/eval on place/undo — Tasks 2–4. Eval reuse — Task 3. Search integration — Task 4. Partial-ID correctness — Task 5.
2. **No placeholders:** tasks include APIs, algorithms, commands; stress test specifies place-then-undo structure.
3. **Type consistency:** `PatternStore.patterns(player)`, `evaluateFromPatterns`, `NarrowConfig.ownPatterns/oppPatterns`, `selectTopMovesFromStore`, `SearchResult.depth` = last complete iteration.
4. **YAGNI:** 4-line rebuild only; no TT, no VCF, no typed arrays, no changing `findPatterns` into a guessing facade.

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-19-incremental-patterns.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with executing-plans checkpoints  

Which approach do you want?
