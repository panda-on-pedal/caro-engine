# Scored Top-K Candidate Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep search branching near-constant by scoring every narrowed candidate (own patterns created/expanded + opponent patterns blocked) and keeping only the top 5 moves at every search node, so think time stays predictable without dropping candidates arbitrarily or requiring a worker pool.

**Architecture:** After `narrowCandidates` builds the forced / urgent / soft∪quiet / quiet set, a new scorer ranks each legal candidate by the change in pattern threat when that move is played. Search (negamax at every ply) already calls `narrowCandidates` per node — so top-K applies at the root and at every deeper depth automatically. Forced four / open-four short-circuits stay exclusive and bypass top-K when the forced set is already tiny. No Web Workers in this plan (the parallel-worker plan was withdrawn).

**Tech Stack:** TypeScript (`nodenext`), existing `patterns.ts` / `narrow.ts` / `search.ts` / `evaluate.ts`, Jest + `parseBoard` fixtures. No new dependencies.

## Global Constraints

- Implement in the `pattern-driven-search` worktree (`caro-engine/.claude/worktrees/pattern-driven-search/`); paths below are relative to that worktree root.
- **Top-K default `K = 5`.** Configurable constant for tests.
- Apply top-K **at every node** where `narrowCandidates` returns a non-forced set (urgent, soft∪quiet, quiet). Forced win/block returns its gain list unchanged (typically 1–2 cells).
- Score heuristic (exact): for candidate move `m` by `player`:
  1. Snapshot pattern score totals for `player` and `opponent` on the current board (reuse `PATTERN_SCORES` from `evaluate.ts`).
  2. `next = placeMove(board, m.row, m.col, player)`.
  3. Recompute pattern score totals on `next`.
  4. `ownDelta = ownAfter - ownBefore` (created/expanded own threats).
  5. `oppDelta = oppBefore - oppAfter` (blocked / reduced opponent threats).
  6. `score(m) = ownDelta + oppDelta`.
  7. Immediate win on `next` (`checkCaroWin` or own `five`) → treat as `+Infinity` (or `WIN_SCORE`) so it always ranks first.
- Sort by `score` descending; ties broken by existing list order (stable) so behavior stays deterministic given the same narrow order.
- Keep returning `NarrowResult { moves, source }` — only `moves` is truncated after scoring.
- Dependency direction unchanged: `search → narrow → patterns/evaluate/board`. Prefer putting the scorer in `narrow.ts` or a sibling `rankMoves.ts` imported by `narrow.ts` — not inside recursive `negamax` separately (one place = every depth).
- No candidate cap without scoring (no `slice(0, 5)` on unsorted lists).
- Out of scope: Web Workers, parallel root split, changing difficulty depths (2/4/6), VCF/VCT.

## File structure

| Path | Role |
|------|------|
| `src/engine/rankMoves.ts` | Pure `scoreMove` + `selectTopMoves(board, player, moves, k)`. |
| `src/engine/rankMoves.spec.ts` | Unit tests for scoring and top-K. |
| `src/engine/narrow.ts` | After building the non-forced move set, call `selectTopMoves(..., TOP_K)`. |
| `src/engine/narrow.spec.ts` | Assert tactical/soft sets are ≤ 5 and prefer dual-purpose / expanding moves. |
| `src/engine/evaluate.ts` | Export or reuse `PATTERN_SCORES` / a small `totalPatternScore(patterns)` helper (no behavior change to `evaluate` itself unless extracting a shared helper). |

```
narrowCandidates(board, player, ...)
  forced four? → return gains (no top-K)
  build urgent / soft∪quiet / quiet set  (existing tier logic)
  moves = selectTopMoves(board, player, moves, 5)
  return { moves, source }
       ↓
negamax at every ply calls narrowCandidates → branching ≈ ≤5
```

---

### Task 1: Pattern-delta move scorer

**Files:**
- Create: `src/engine/rankMoves.ts`
- Create: `src/engine/rankMoves.spec.ts`
- Modify: `src/engine/evaluate.ts` (extract shared `totalPatternScore` if needed)

**Interfaces:**
- Consumes: `Board`, `Player`, `Move`, `placeMove`, `findPatterns`, `PATTERN_SCORES`, `checkCaroWin` (optional for win short-circuit)
- Produces:
  ```ts
  export const DEFAULT_TOP_K = 5;

  /** Sum of PATTERN_SCORES over instances (no tempo multiplier). */
  export function totalPatternScore(patterns: PatternInstance[]): number;

  /**
   * ownDelta + oppDelta after playing `move` as `player`.
   * Immediate five / win → Number.POSITIVE_INFINITY.
   */
  export function scoreMove(
    board: Board,
    player: Player,
    move: Move,
  ): number;

  /**
   * Stable sort by scoreMove descending; return first `k` moves.
   * If moves.length <= k, return a shallow copy in scored order.
   */
  export function selectTopMoves(
    board: Board,
    player: Player,
    moves: readonly Move[],
    k?: number, // default DEFAULT_TOP_K
  ): Move[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/rankMoves.spec.ts
import { parseBoard } from "./test-helpers/parse-board.ts";
import { scoreMove, selectTopMoves } from "./rankMoves.ts";
import { placeMove } from "./board.ts";

describe("scoreMove", () => {
  it("scores higher when a move both expands own open-two and blocks opponent", () => {
    // Same soft position family as the 9,8 inspection: dual-purpose 11,10
    // should beat a one-sided block like 10,6.
    let board = parseBoard(`
      ......
      ......
      ......
      ......
      ......
      ......
    `);
    // Build via placeMove for clarity if ASCII is awkward — or use a
    // fixture matching: O at 8,10 / 10,11 / 12,9; X at 9,8 / 9,9 / 10,8 / 10,9
    // (implementer: use createEmptyBoard(20) + placeMove sequence from
    // my-game-inspections / prior probe).
    board = /* constructed board after X@9,8 */;
    const dual = scoreMove(board, 2, { row: 11, col: 10 });
    const weak = scoreMove(board, 2, { row: 10, col: 6 });
    expect(dual).toBeGreaterThan(weak);
  });

  it("returns +Infinity when the move wins immediately", () => {
    const board = parseBoard("XXXX.");
    expect(scoreMove(board, 1, { row: 0, col: 4 })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("selectTopMoves", () => {
  it("returns at most k moves, highest scores first", () => {
    const board = parseBoard("..XX...");
    const moves = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 4 },
      { row: 0, col: 5 },
      { row: 0, col: 6 },
      { row: 1, col: 2 },
    ];
    const top = selectTopMoves(board, 1, moves, 3);
    expect(top).toHaveLength(3);
    const scores = top.map((m) => scoreMove(board, 1, m));
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
    expect(scores[1]).toBeGreaterThanOrEqual(scores[2]);
  });

  it("preserves relative order for equal scores (stable)", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    // Far empty cells with identical zero deltas keep input order.
    const moves = [
      { row: 0, col: 0 },
      { row: 0, col: 4 },
      { row: 4, col: 0 },
    ];
    const top = selectTopMoves(board, 2, moves, 3);
    expect(top.map((m) => `${m.row},${m.col}`)).toEqual([
      "0,0",
      "0,4",
      "4,0",
    ]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx jest src/engine/rankMoves.spec.ts --no-coverage`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `rankMoves.ts`**

```ts
import { placeMove, type Board, type Player } from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { findPatterns, type PatternInstance } from "./patterns.ts";
import { PATTERN_SCORES } from "./evaluate.ts";
import type { Move } from "./state.ts";

export const DEFAULT_TOP_K = 5;

export function totalPatternScore(patterns: PatternInstance[]): number {
  let total = 0;
  for (const p of patterns) {
    total += PATTERN_SCORES[p.type];
  }
  return total;
}

export function scoreMove(board: Board, player: Player, move: Move): number {
  const opponent: Player = player === 1 ? 2 : 1;
  const ownBefore = totalPatternScore(findPatterns(board, player));
  const oppBefore = totalPatternScore(findPatterns(board, opponent));
  const next = placeMove(board, move.row, move.col, player);
  if (checkCaroWin(next, move.row, move.col, player)) {
    return Number.POSITIVE_INFINITY;
  }
  const ownAfter = totalPatternScore(findPatterns(next, player));
  const oppAfter = totalPatternScore(findPatterns(next, opponent));
  return ownAfter - ownBefore + (oppBefore - oppAfter);
}

export function selectTopMoves(
  board: Board,
  player: Player,
  moves: readonly Move[],
  k: number = DEFAULT_TOP_K,
): Move[] {
  if (moves.length <= k) {
    return [...moves].sort(
      (a, b) => scoreMove(board, player, b) - scoreMove(board, player, a),
    );
  }
  const ranked = moves.map((move, index) => ({
    move,
    index,
    score: scoreMove(board, player, move),
  }));
  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });
  return ranked.slice(0, k).map((r) => r.move);
}
```

Note: sorting when `length <= k` still reorders by score (good for move ordering). Avoid double-scoring in hot paths later with a single map (refactor OK in this task).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx jest src/engine/rankMoves.spec.ts --no-coverage`

- [ ] **Step 5: Commit**

```bash
git add src/engine/rankMoves.ts src/engine/rankMoves.spec.ts src/engine/evaluate.ts
git commit -m "feat(engine): score moves by own expand + opp block deltas"
```

---

### Task 2: Wire top-K into `narrowCandidates` (every search ply)

**Files:**
- Modify: `src/engine/narrow.ts`
- Modify: `src/engine/narrow.spec.ts`

**Interfaces:**
- Consumes: `selectTopMoves`, `DEFAULT_TOP_K`
- Produces: same `narrowCandidates` signature; non-forced results have `moves.length <= DEFAULT_TOP_K`

**Behavior:**
1. Forced own/opp four → return as today (no top-K).
2. After building urgent, soft∪quiet, or quiet `moves` array (post-reorder is fine either before or after score — **score then take top K**, then optional light shuffle is **not** desired; drop weighted reorder for the final list or apply reorder only among ties — prefer: `selectTopMoves` then return, no random reorder after ranking so the best scored move is first for `patternOnlyStrategy`).
3. Soft∪quiet: build full merged set first, **then** `selectTopMoves` (so quiet fillers compete in the score, dual-purpose wins).

- [ ] **Step 1: Write / update failing tests in `narrow.spec.ts`**

```ts
it("limits non-forced tactical sets to at most 5 moves", () => {
  // Soft position with many open-two critical gains (e.g. after X@9,8 fixture).
  const board = /* same 20x20 fixture */;
  const result = narrowCandidates(board, 2, 7, {
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    decay: BASE_CONFIG.decay,
    rng: () => 0.5,
  });
  expect(result.source).toBe("tactical");
  expect(result.moves.length).toBeLessThanOrEqual(5);
});

it("prefers a dual-purpose expand+block over a weak one-sided block", () => {
  const board = /* same fixture */;
  const result = narrowCandidates(board, 2, 7, {
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    decay: BASE_CONFIG.decay,
    rng: () => 0.5,
  });
  expect(result.moves.some((m) => m.row === 11 && m.col === 10)).toBe(true);
  // Weak block should often be dropped when more than 5 compete; at minimum
  // 11,10 must outrank 10,6 when both would otherwise be included:
  const keys = result.moves.map((m) => `${m.row},${m.col}`);
  if (keys.includes("10,6")) {
    expect(keys.indexOf("11,10")).toBeLessThan(keys.indexOf("10,6"));
  }
});

it("does not top-K forced four gains", () => {
  const board = parseBoard("XOOOO.");
  const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
  expect(result.source).toBe("forced");
  expect(result.moves).toEqual([{ row: 0, col: 5 }]);
});
```

Update existing soft∪quiet tests that assumed `moves.length > softKeys.size` — after top-K, length is ≤5 but must still include high-scoring soft gains and preferably a development cell if it scores well. Adjust assertions to score-based expectations rather than “length > soft only”.

- [ ] **Step 2: Run — expect FAIL** on new top-K / dual-purpose tests

Run: `npx jest src/engine/narrow.spec.ts --no-coverage`

- [ ] **Step 3: Implement wiring in `narrow.ts`**

At each non-forced return:

```ts
return {
  moves: selectTopMoves(board, player, [...moveMap.values()], DEFAULT_TOP_K),
  source: "tactical", // or "quiet"
};
```

Remove or skip final `weightedReorder` on the selected set so ranking is score-primary (randomness already applied when sampling quiet fillers before merge).

- [ ] **Step 4: Run all narrow tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/engine/narrow.ts src/engine/narrow.spec.ts
git commit -m "feat(narrow): keep top-5 scored candidates at every node"
```

---

### Task 3: Search / engine smoke verification

**Files:**
- Modify only if needed: `src/engine/search.spec.ts` (assertions on branching)
- No worker / UI changes required for this plan

- [ ] **Step 1: Add a focused search smoke test**

```ts
it("negamax root branching stays within top-K after narrowing", () => {
  const board = /* busy soft fixture */;
  const narrowed = narrowCandidates(board, 2, 7, {
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    decay: DEFAULT_DECAY_CONFIG,
  });
  expect(narrowed.moves.length).toBeLessThanOrEqual(5);
  const result = search(board, 2, { maxDepth: 2, timeBudgetMs: 2000 });
  expect(result.move).toBeDefined();
});
```

- [ ] **Step 2: Run engine suite**

Run: `npx jest src/engine --no-coverage`  
Expected: PASS (difficulty smoke may still be flaky; re-run once if needed)

- [ ] **Step 3: Manual check (optional)**  
Replay X@9,8 position: root log should list ≤5 moves including `11,10`; UI think time should feel much more even on hard.

- [ ] **Step 4: Commit if search spec changed**

```bash
git add src/engine/search.spec.ts
git commit -m "test(search): assert top-K narrow bound on soft positions"
```

---

## Self-review

| Requirement | Task |
|-------------|------|
| Score = own expand/create + opp block | Task 1 `scoreMove` |
| Top 5 only examined | Task 2 `selectTopMoves` in `narrowCandidates` |
| Every depth / every node | Task 2 (negamax already calls `narrowCandidates` per ply) |
| Forced fours bypass top-K | Task 2 |
| Dual-purpose preferred (11,10 vs 10,6) | Task 1 + 2 tests |
| No worker pool | Global out-of-scope; prior plan deleted |
| Near-constant branching | Task 2 + 3 |

**Performance note:** Scoring each candidate costs 2× `findPatterns` before the move snapshots can be shared once per `selectTopMoves` call (`ownBefore`/`oppBefore` computed once). Implement that optimization in Task 1 (compute before-scores once in `selectTopMoves`, pass into an internal `scoreMoveWithBaseline`) so scoring 20 candidates is not 40 full baseline rescans.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-18-scored-top-k-candidates.md`.

The parallel search worker plan was **removed**.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task  
2. **Inline Execution** — run tasks in this session  

Which approach?
