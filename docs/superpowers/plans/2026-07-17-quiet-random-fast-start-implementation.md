# Quiet Random Fast-Start + Open-Two Narrowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip negamax on quiet openings (distance-weighted random only) and treat `open-two` as tactical so its `criticalGains` enter the search candidate set.

**Architecture:** `narrowCandidates` returns a tagged `{ moves, source }` (`forced` | `tactical` | `quiet`) and Step 3 also collects own/opponent `open-two` `criticalGains`. Root `search()` uses `patternOnlyStrategy` when `source === "quiet"` (unless an explicit strategy override is passed); forced/tactical keep `negamaxStrategy`. Mid-tree negamax nodes use `.moves` only.

**Tech Stack:** TypeScript, Jest (`npm test`), existing `parseBoard` / engine helpers in `src/engine/`.

## Global Constraints

- TDD throughout: failing test first, then minimal implementation.
- Extends approved spec `docs/superpowers/specs/2026-07-17-quiet-random-fast-start-design.md`.
- No public `chooseMove` API change.
- Root-only quiet short-circuit (not mid-tree).
- Open-two recognition is always on (not difficulty-gated).
- Work in worktree: `caro-engine/.claude/worktrees/pattern-driven-search`.

## File Structure

| File | Role |
| --- | --- |
| `src/engine/narrow.ts` | Tag returns; add open-two to Step 3 |
| `src/engine/narrow.spec.ts` | Open-two tactical + quiet `source` tests; update `Move[]` assertions to `.moves` |
| `src/engine/search.ts` | Root quiet → `patternOnlyStrategy`; use `.moves` in negamax |
| `src/engine/search.spec.ts` | Quiet depth-0; open-two searches; fix quiet boards that assumed negamax |
| `src/engine/engine.spec.ts` | Quiet `chooseMove` depth-0; fix depth-comparison fixture |

---

### Task 1: Tag `narrowCandidates` return + open-two in Step 3

**Files:**
- Modify: `src/engine/narrow.ts`
- Modify: `src/engine/narrow.spec.ts`
- Modify: `src/engine/search.ts` (call sites → `.moves` so typecheck/tests compile after API change)

**Interfaces:**
- Consumes: existing `PatternInstance.criticalGains`, `NarrowConfig`
- Produces:

```ts
export type NarrowSource = "forced" | "tactical" | "quiet";

export type NarrowResult = {
  moves: Move[];
  source: NarrowSource;
};

export function narrowCandidates(
  board: Board,
  player: Player,
  moveCount: number,
  config: NarrowConfig,
): NarrowResult;
```

- [ ] **Step 1: Write the failing tests in `narrow.spec.ts`**

Update every existing `narrowCandidates(...)` assertion that treats the return as `Move[]` to use `.moves` (and add `source` where useful). Add:

```ts
describe("narrowCandidates — open-two tactical", () => {
  it("includes own open-two criticalGains and tags source tactical", () => {
    const board = parseBoard("..XX...");
    const own = findPatterns(board, 1).find((p) => p.type === "open-two")!;
    expect(own.criticalGains.length).toBeGreaterThan(0);

    const result = narrowCandidates(board, 1, 2, BASE_CONFIG);
    expect(result.source).toBe("tactical");
    const keys = new Set(result.moves.map((m) => `${m.row},${m.col}`));
    for (const gain of own.criticalGains) {
      expect(keys.has(`${gain.row},${gain.col}`)).toBe(true);
    }
  });

  it("includes opponent open-two criticalGains", () => {
    const board = parseBoard("..OO...");
    const opp = findPatterns(board, 2).find((p) => p.type === "open-two")!;
    expect(opp.criticalGains.length).toBeGreaterThan(0);

    const result = narrowCandidates(board, 1, 2, BASE_CONFIG);
    expect(result.source).toBe("tactical");
    const keys = new Set(result.moves.map((m) => `${m.row},${m.col}`));
    for (const gain of opp.criticalGains) {
      expect(keys.has(`${gain.row},${gain.col}`)).toBe(true);
    }
  });
});

describe("narrowCandidates — quiet source tag", () => {
  it("tags quiet when only isolated stones exist", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    const result = narrowCandidates(board, 2, 1, BASE_CONFIG);
    expect(result.source).toBe("quiet");
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves.length).toBeLessThanOrEqual(8);
  });
});
```

Also update forced/tactical/quiet existing tests, e.g.:

```ts
const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
expect(result.source).toBe("forced");
expect(result.moves).toEqual([{ row: 0, col: 5 }]);
```

```ts
const result = narrowCandidates(board, 1, 3, BASE_CONFIG);
expect(result.source).toBe("tactical");
expect(result.moves.map((m) => `${m.row},${m.col}`).sort()).toEqual(
  ["0,1", "0,5"].sort(),
);
```

**Important existing-test break:**  
`does not include an unrecognized fork point...` assumed open-twos were ignored. With open-two in Step 3, the double-three-trap shape’s `criticalGains` include the shared cell even when forks are unrecognized. Rewrite that test to either (a) assert the fork cell **is** present via open-two gains, or (b) drop the “must not include (2,5)” assertion and only assert open-three cells remain present.

For the reorder test that indexes `low[0]` / `high[0]`, switch to `low.moves[0]` / `high.moves[0]`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/engine/narrow.spec.ts
```

Expected: FAIL — `narrowCandidates` still returns `Move[]` (no `.source` / `.moves`), and/or open-two boards still fall through to quiet without including open-two gains.

- [ ] **Step 3: Implement tagged return + open-two in Step 3**

In `src/engine/narrow.ts`:

1. Export `NarrowSource` and `NarrowResult`.
2. Change each return:
   - Step 1/2: `return { moves: ..., source: "forced" };`
   - Step 3 non-empty: `return { moves: weightedReorder(...), source: "tactical" };`
   - Step 4: `return { moves: ..., source: "quiet" };`
3. Extend the open-three loops to also accept `open-two`:

```ts
for (const pattern of ownPatterns) {
  if (pattern.type === "open-three" || pattern.type === "open-two") {
    addAll(pattern.criticalGains);
  }
}
for (const pattern of oppPatterns) {
  if (pattern.type === "open-three" || pattern.type === "open-two") {
    addAll(pattern.criticalGains);
  }
}
```

In `src/engine/search.ts`, update every `narrowCandidates(...)` use to `.moves`:

```ts
const moves =
  rootMoves ??
  narrowCandidates(board, player, moveCount, narrowConfig).moves;
```

```ts
const candidates = narrowCandidates(
  board,
  player,
  moveCount,
  narrowConfig,
).moves;
```

Do **not** add the quiet short-circuit in this task (Task 2).

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/engine/narrow.spec.ts src/engine/search.spec.ts src/engine/engine.spec.ts
```

Expected: PASS for narrow open-two/source tests; search/engine may still show quiet boards searching (unchanged until Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/engine/narrow.ts src/engine/narrow.spec.ts src/engine/search.ts
git commit -m "$(cat <<'EOF'
feat: tag narrowCandidates and include open-two gains

EOF
)"
```

---

### Task 2: Root quiet → random only (`patternOnlyStrategy`)

**Files:**
- Modify: `src/engine/search.ts`
- Modify: `src/engine/search.spec.ts`
- Modify: `src/engine/engine.spec.ts`

**Interfaces:**
- Consumes: `NarrowResult` from Task 1; existing `patternOnlyStrategy` / `negamaxStrategy`
- Produces: `search(board, player, config, strategy?: MoveSelectionStrategy)` — optional strategy; when omitted, quiet uses `patternOnlyStrategy`, else `negamaxStrategy`

- [ ] **Step 1: Write the failing tests**

In `search.spec.ts`, add:

```ts
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
```

(Import `findPatterns` from `./patterns.ts` in `search.spec.ts`.)

Update tests that assumed quiet boards still deepen:

1. `"reaches the requested depth..."` — either pass `negamaxStrategy` explicitly, or switch the fixture to a tactical board (e.g. `..XX...`) and keep asserting `depth === 2`.
2. `"defaults to negamaxStrategy, which explores multiple nodes"` — use a tactical fixture (`..XX...` or `OXXXX.`) so default path still explores, **or** rename and assert quiet defaults to zero nodes while `search(..., negamaxStrategy)` explores.

Update regression `"does not always play the same relative first move"` — still valid with quiet random; keep it (may flaky if rng unlucky — existing pattern is fine).

In `engine.spec.ts`:

```ts
it("returns a SearchResult whose move is legal on an empty board", () => {
  const state = newGame();
  const result = chooseMove(state, { difficulty: "easy" });
  expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
    true,
  );
  expect(result.depth).toBe(0);
  expect(result.nodesVisited).toBe(0);
  expect(Array.isArray(result.principalVariation)).toBe(true);
});

it("returns depth 0 on a quiet first-reply board", () => {
  let state = newGame();
  state = applyMove(state, { row: 7, col: 7 }, 1);
  const result = chooseMove(state, { difficulty: "easy" });
  expect(result.depth).toBe(0);
  expect(result.nodesVisited).toBe(0);
  expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
    true,
  );
});
```

Fix `"searches deeper at hard than at easy"` — isolated stones are quiet (both depth 0). Use a tactical fixture, e.g. build an open-two for player 1 then call both difficulties:

```ts
it("searches deeper at hard than at easy for the same tactical position", () => {
  let state = newGame();
  // Build an open-two for X so the position is tactical (not quiet random).
  state = applyMove(state, { row: 10, col: 10 }, 1);
  state = applyMove(state, { row: 0, col: 0 }, 2);
  state = applyMove(state, { row: 10, col: 11 }, 1);
  state = applyMove(state, { row: 0, col: 2 }, 2);

  const easy = chooseMove(state, { difficulty: "easy" });
  const hard = chooseMove(state, { difficulty: "hard", timeBudgetMs: 2000 });
  expect(easy.depth).toBeGreaterThan(0);
  expect(hard.depth).toBeGreaterThanOrEqual(easy.depth);
});
```

(Verify with `findPatterns` in a scratch if needed that this is `open-two` and not quieter/forced.)

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/engine/search.spec.ts src/engine/engine.spec.ts
```

Expected: FAIL — quiet boards still return `depth > 0` / `nodesVisited > 0`.

- [ ] **Step 3: Implement root quiet short-circuit**

Replace `search` signature/body in `src/engine/search.ts`:

```ts
export function search(
  board: Board,
  player: Player,
  config: SearchConfig,
  strategy?: MoveSelectionStrategy,
): SearchResult {
  const narrowConfig = resolveNarrowConfig(config);
  const moveCount = countStones(board);
  const narrowed = narrowCandidates(board, player, moveCount, narrowConfig);

  if (narrowed.moves.length === 0) {
    const fallbackMoves = findCandidateMoves(board);
    return {
      move: fallbackMoves[0],
      score: 0,
      depth: 0,
      principalVariation: [],
      nodesVisited: 0,
    };
  }

  const resolvedStrategy =
    strategy ??
    (narrowed.source === "quiet" ? patternOnlyStrategy : negamaxStrategy);

  return resolvedStrategy(board, player, narrowed.moves, config);
}
```

Keep mid-tree `narrowCandidates(...).moves` as in Task 1 (no source branching).

- [ ] **Step 4: Run full engine tests**

Run:

```bash
npm test -- src/engine/
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/search.ts src/engine/search.spec.ts src/engine/engine.spec.ts
git commit -m "$(cat <<'EOF'
feat: skip search on quiet boards with weighted random

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| Quiet = random only, no negamax, depth 0 | Task 2 |
| Open-two ends quiet / joins Step 3 (own + opp) | Task 1 |
| Forced four / open-three / forks unchanged | Task 1 (extend only) |
| Tagged `NarrowResult` | Task 1 |
| Explicit strategy still overrides | Task 2 (`strategy ?? ...`) |
| Root-only short-circuit | Task 2 |
| Update empty/single-stone depth assertions | Task 2 |
| No first-stone-only reweight / no difficulty-gate open-two | Non-goals (no tasks) |

## Placeholder scan

No TBD/TODO placeholders. Exact fixtures and commands included.

## Type consistency

- `NarrowResult.moves` / `NarrowResult.source` used consistently across tasks.
- `search(..., strategy?: MoveSelectionStrategy)` optional override matches design.
