# Threat-Space Search + Expert Difficulty — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic threat-space search (option A: fours, open-three critical gains, recognized forks), gate it behind a new `expert` difficulty, and unify all per-difficulty knobs into one `DIFFICULTY_PROFILES` table.

**Architecture:** New `threatSearch.ts` proves forced wins on a thin AND/OR tree using `PatternStore` place/undo. `search` runs TSS first when enabled, then falls back to today’s negamax. `engine.ts` exposes a single `DIFFICULTY_PROFILES` map so tuning a level is one object edit. UI gains an Expert option.

**Tech Stack:** TypeScript (`nodenext`, `.ts` import extensions), Jest + `parseBoard`, existing `PatternStore` / `patterns` / `narrow` / `search` / `engine`. No new dependencies.

## Global Constraints

- Implement on feature branch `feat/threat-space-search` (already created from `main`). Paths are relative to the `caro-engine` repo root.
- Spec: `docs/superpowers/specs/2026-07-19-threat-space-search-design.md` (option A threat set).
- Dependency direction: `engine → search → threatSearch → patternStore / patterns / rules / narrow-helpers`. `threatSearch` must not import `engine`.
- easy / medium / hard behavior must stay unchanged (TSS off). Strength for expert comes from TSS, not a deeper negamax than hard.
- TDD: failing test → implement → pass → commit per task.
- Out of scope: TT/Zobrist, typed arrays, opening book, score retune, LLM bridge UI, option-B threats (plain three / open-two).

## File structure

| Path | Role |
|------|------|
| `src/engine/engine.ts` | `Difficulty` + `expert`; unify `DIFFICULTY_PROFILES`; resolve overrides into `SearchConfig`. |
| `src/engine/threatSearch.ts` | NEW — threat/defence move sets + `findForcedWin`. |
| `src/engine/threatSearch.spec.ts` | NEW — prover unit tests. |
| `src/engine/narrow.ts` | Export `boxCell` + `survivingBlocks` for shared defence logic. |
| `src/engine/search.ts` | `threatSearch` / `threatMaxPly` on `SearchConfig`; run TSS before negamax. |
| `src/engine/search.spec.ts` | Integration: TSS-on finds force; TSS-off fallback. |
| `src/engine/engine.spec.ts` | Profile resolution / expert flag smoke if needed. |
| `index.html` | Expert `<option>` on all three difficulty selects. |
| `docs/superpowers/specs/2026-07-16-gomoku-engine-design.md` | Note Phase B in progress / point at new spec (one-line). |

```
chooseMove(state, { difficulty })
  → profile = DIFFICULTY_PROFILES[difficulty]
  → search(board, player, { ...profile, overrides })
       PatternStore.fromBoard
       if threatSearch:
         opp force? → defend (narrow root to defence cells) / own force? → return PV[0]
       narrowCandidates + negamax / patternOnly (unchanged)
```

---

### Task 1: Unify `DIFFICULTY_PROFILES` + add `expert` type

**Files:**
- Modify: `src/engine/engine.ts`
- Modify: `src/engine/engine.spec.ts` (or add focused tests there)
- Modify: `index.html` (Expert options — UI can land here so the type is usable end-to-end)

**Interfaces:**
- Consumes: `ALL_FORK_PATTERN_NAMES`, `ForkPatternName` from `narrow.ts`; `search` / `SearchConfig` from `search.ts`
- Produces:
  ```ts
  export type Difficulty = "easy" | "medium" | "hard" | "expert";

  export interface DifficultyProfile {
    maxDepth: number;
    timeBudgetMs: number;
    recognizedForkPatterns: ReadonlySet<ForkPatternName>;
    rootScoreJitter: number;
    threatSearch: boolean;
    threatMaxPly: number;
  }

  export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile>;

  export interface EngineConfig {
    difficulty: Difficulty;
    timeBudgetMs?: number;
    rootScoreJitter?: number;
    threatSearch?: boolean;
  }
  ```
  `SearchConfig` gains optional `threatSearch?: boolean` and `threatMaxPly?: number` in this task (stubs ignored by `search` until Task 4) so `chooseMove` can pass them without type errors.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/engine.spec.ts` (create describe if needed):

```ts
import {
  DIFFICULTY_PROFILES,
  chooseMove,
  type Difficulty,
} from "./engine.ts";
import { createGameState } from "./state.ts"; // use whatever constructor exists — createEmpty / initial state helper already used in engine.spec
import { ALL_FORK_PATTERN_NAMES } from "./narrow.ts";

describe("DIFFICULTY_PROFILES", () => {
  it("is the single table covering every Difficulty key", () => {
    const keys: Difficulty[] = ["easy", "medium", "hard", "expert"];
    for (const d of keys) {
      expect(DIFFICULTY_PROFILES[d]).toBeDefined();
    }
  });

  it("enables threat search only on expert", () => {
    expect(DIFFICULTY_PROFILES.easy.threatSearch).toBe(false);
    expect(DIFFICULTY_PROFILES.medium.threatSearch).toBe(false);
    expect(DIFFICULTY_PROFILES.hard.threatSearch).toBe(false);
    expect(DIFFICULTY_PROFILES.expert.threatSearch).toBe(true);
    expect(DIFFICULTY_PROFILES.expert.threatMaxPly).toBe(16);
  });

  it("keeps prior depth / budget / fork / jitter values for easy-medium-hard", () => {
    expect(DIFFICULTY_PROFILES.easy).toMatchObject({
      maxDepth: 2,
      timeBudgetMs: 500,
      rootScoreJitter: 0.15,
      threatMaxPly: 0,
    });
    expect(DIFFICULTY_PROFILES.easy.recognizedForkPatterns.size).toBe(0);
    expect(DIFFICULTY_PROFILES.medium).toMatchObject({
      maxDepth: 4,
      timeBudgetMs: 2000,
      rootScoreJitter: 0.1,
    });
    expect(DIFFICULTY_PROFILES.medium.recognizedForkPatterns).toEqual(
      new Set(["double-three-trap", "double-four-trap"]),
    );
    expect(DIFFICULTY_PROFILES.hard).toMatchObject({
      maxDepth: 6,
      timeBudgetMs: 5000,
      rootScoreJitter: 0.05,
    });
    expect(DIFFICULTY_PROFILES.hard.recognizedForkPatterns).toEqual(
      ALL_FORK_PATTERN_NAMES,
    );
    expect(DIFFICULTY_PROFILES.expert).toMatchObject({
      maxDepth: 6,
      timeBudgetMs: 10000,
      rootScoreJitter: 0.02,
      recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    });
  });

  it("chooseMove passes threatSearch from the profile unless overridden", () => {
    // Spy search or assert via a tiny exported resolve helper.
    // Preferred: export function resolveEngineSearchConfig(config: EngineConfig): SearchConfig
    // and unit-test that instead of spying.
  });
});
```

Prefer exporting:

```ts
export function resolveEngineSearchConfig(config: EngineConfig): SearchConfig
```

so the last test becomes:

```ts
it("resolveEngineSearchConfig merges profile with overrides", () => {
  const base = resolveEngineSearchConfig({ difficulty: "expert" });
  expect(base.threatSearch).toBe(true);
  expect(base.threatMaxPly).toBe(16);
  expect(base.maxDepth).toBe(6);
  expect(base.timeBudgetMs).toBe(10000);

  const overridden = resolveEngineSearchConfig({
    difficulty: "hard",
    threatSearch: true,
    timeBudgetMs: 123,
  });
  expect(overridden.threatSearch).toBe(true);
  expect(overridden.timeBudgetMs).toBe(123);
  expect(overridden.maxDepth).toBe(6); // still hard's depth
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/engine.spec.ts`
Expected: FAIL — `DIFFICULTY_PROFILES` / `expert` / `resolveEngineSearchConfig` missing.

- [ ] **Step 3: Write minimal implementation**

In `engine.ts`:

1. Delete `DIFFICULTY_DEPTH`, `DIFFICULTY_TIME_BUDGET_MS`, `DIFFICULTY_FORK_PATTERNS`, `DIFFICULTY_ROOT_JITTER`.
2. Add `DifficultyProfile`, `DIFFICULTY_PROFILES` with the values from the test.
3. Add `resolveEngineSearchConfig` that returns:
   ```ts
   {
     maxDepth: profile.maxDepth,
     timeBudgetMs: config.timeBudgetMs ?? profile.timeBudgetMs,
     recognizedForkPatterns: profile.recognizedForkPatterns,
     decay: DEFAULT_DECAY_CONFIG,
     rootScoreJitter: config.rootScoreJitter ?? profile.rootScoreJitter,
     threatSearch: config.threatSearch ?? profile.threatSearch,
     threatMaxPly: profile.threatMaxPly,
   }
   ```
4. `chooseMove` becomes `return search(state.board, state.nextPlayer, resolveEngineSearchConfig(config));`
5. Extend `SearchConfig` in `search.ts` with optional `threatSearch?: boolean` and `threatMaxPly?: number` (no behavior yet).
6. In `index.html`, add `<option value="expert">Expert</option>` (and `P1: Expert` / `P2: Expert`) to the three selects.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/engine/engine.spec.ts`
Expected: PASS. Also run full `npm test` and fix any imports that referenced removed constants.

- [ ] **Step 5: Commit**

```bash
git add src/engine/engine.ts src/engine/engine.spec.ts src/engine/search.ts index.html
git commit -m "$(cat <<'EOF'
refactor: unify difficulty profiles and add expert tier

EOF
)"
```

---

### Task 2: Export shared defence helpers from `narrow.ts`

**Files:**
- Modify: `src/engine/narrow.ts`
- Modify: `src/engine/narrow.spec.ts` (only if a tiny export smoke is useful; otherwise rely on existing forced-tier tests)

**Interfaces:**
- Consumes: existing private `boxCell`, `survivingBlocks`
- Produces: same functions exported:
  ```ts
  export function boxCell(pattern: PatternInstance, board: Board): Move | null;
  export function survivingBlocks(
    board: Board,
    defender: Player,
    attacker: Player,
    candidates: Move[],
  ): Move[];
  ```

- [ ] **Step 1: Write the failing test**

Add to `narrow.spec.ts`:

```ts
import { boxCell, survivingBlocks } from "./narrow.ts";

describe("exported defence helpers", () => {
  it("boxCell returns the outer box for a one-sided four", () => {
    // Reuse any existing four fixture from this file that already asserts
    // forced-tier includes a box cell; call boxCell directly and expect
    // the same coordinate documented in that fixture.
  });
});
```

If an existing test already covers behavior through `narrowCandidates`, a minimal re-export is enough — add one direct `boxCell` assertion copied from catalog # style fixture already in `narrow.spec.ts` / `board-state-catalog.spec.ts` (e.g. gain + box pair).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/narrow.spec.ts -t "exported defence helpers"`
Expected: FAIL — `boxCell` not exported.

- [ ] **Step 3: Minimal implementation**

Change `function boxCell` → `export function boxCell` and `function survivingBlocks` → `export function survivingBlocks`. No logic changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/engine/narrow.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/narrow.ts src/engine/narrow.spec.ts
git commit -m "$(cat <<'EOF'
refactor: export boxCell and survivingBlocks for TSS

EOF
)"
```

---

### Task 3: `findForcedWin` core (threat moves + AND/OR prover)

**Files:**
- Create: `src/engine/threatSearch.ts`
- Create: `src/engine/threatSearch.spec.ts`

**Interfaces:**
- Consumes: `PatternStore`, `checkCaroWin`, `findForkPoints` / `recognizedForkPoints`, `ALL_FORK_PATTERN_NAMES`, `boxCell`, `survivingBlocks`, `WIN_SCORE` (not required inside prover)
- Produces:
  ```ts
  export type ForcedWinResult = {
    won: boolean;
    principalVariation: Move[];
    nodesVisited: number;
  };

  export type ThreatSearchOptions = {
    maxPly: number;
    deadline?: number | null;
    recognizedForkPatterns?: ReadonlySet<ForkPatternName>;
  };

  /** Option-A attacker threat cells, ordered: four gains → forks → open-three criticalGains. */
  export function collectAttackThreatMoves(
    store: PatternStore,
    attacker: Player,
    recognizedForkPatterns: ReadonlySet<ForkPatternName>,
  ): Move[];

  /** Exclusive defence set after attacker's last move (spec priority 1→2→3). */
  export function collectDefenceMoves(
    store: PatternStore,
    attacker: Player,
    defender: Player,
    recognizedForkPatterns: ReadonlySet<ForkPatternName>,
  ): Move[];

  export function findForcedWin(
    store: PatternStore,
    attacker: Player,
    options: ThreatSearchOptions,
  ): ForcedWinResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `threatSearch.spec.ts`:

```ts
import { parseBoard } from "./test-helpers/parse-board.ts";
import { PatternStore } from "./patternStore.ts";
import { ALL_FORK_PATTERN_NAMES } from "./narrow.ts";
import {
  collectAttackThreatMoves,
  collectDefenceMoves,
  findForcedWin,
} from "./threatSearch.ts";

const forks = ALL_FORK_PATTERN_NAMES;

describe("collectAttackThreatMoves", () => {
  it("includes four gains", () => {
    const board = parseBoard(".XXXX.");
    const store = PatternStore.fromBoard(board);
    const moves = collectAttackThreatMoves(store, 1, forks);
    const keys = new Set(moves.map((m) => `${m.row},${m.col}`));
    expect(keys.has("0,0") || keys.has("0,5")).toBe(true); // adjust to actual parseBoard coords
  });

  it("includes open-three criticalGains and not plain open-two only positions as threats from twos alone", () => {
    const board = parseBoard("..XXX..");
    const store = PatternStore.fromBoard(board);
    const moves = collectAttackThreatMoves(store, 1, forks);
    expect(moves.length).toBeGreaterThan(0);
  });
});

describe("findForcedWin", () => {
  it("proves an immediate four win", () => {
    const board = parseBoard(".XXXX.");
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, { maxPly: 4, recognizedForkPatterns: forks });
    expect(result.won).toBe(true);
    expect(result.principalVariation.length).toBeGreaterThanOrEqual(1);
    store.place(result.principalVariation[0], 1);
    // checkCaroWin true
  });

  it("returns won:false on a quiet board", () => {
    const board = parseBoard(`
      ..........
      ....X.....
      .....O....
      ..........
    `);
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, { maxPly: 8, recognizedForkPatterns: forks });
    expect(result.won).toBe(false);
    expect(result.principalVariation).toEqual([]);
  });

  it("proves a fork force at the shared gain", () => {
    // Reuse patterns.spec open-three + four fork at (2,5)
    const board = parseBoard(`
      .......
      .......
      O.XXX..
      .....X.
      .....X.
      .....X.
      .......
    `);
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, { maxPly: 8, recognizedForkPatterns: forks });
    expect(result.won).toBe(true);
    expect(result.principalVariation[0]).toEqual({ row: 2, col: 5 });
  });

  it("stops when maxPly is 0", () => {
    const board = parseBoard(".XXXX.");
    const store = PatternStore.fromBoard(board);
    const result = findForcedWin(store, 1, { maxPly: 0, recognizedForkPatterns: forks });
    expect(result.won).toBe(false);
  });
});
```

Fix coordinates after the first run against real `parseBoard` output (read failing diffs; do not guess silently).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/engine/threatSearch.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `threatSearch.ts`**

Algorithm sketch (must match the design spec):

```ts
function other(p: Player): Player { return p === 1 ? 2 : 1; }

export function collectAttackThreatMoves(store, attacker, recognizedForkPatterns): Move[] {
  const patterns = store.patterns(attacker);
  const seen = new Set<string>();
  const out: Move[] = [];
  const pushAll = (moves: Move[]) => { /* dedupe into out */ };

  // 1) four / open-four gains
  for (const p of patterns) {
    if (p.type === "four" || p.type === "open-four") pushAll(p.gains);
  }
  // 2) recognized fork points
  for (const f of recognizedForkPoints(patterns, recognizedForkPatterns)) {
    pushAll([f.move]);
  }
  // 3) open-three criticalGains
  for (const p of patterns) {
    if (p.type === "open-three") pushAll(p.criticalGains);
  }
  return out;
}

export function collectDefenceMoves(store, attacker, defender, recognizedForkPatterns): Move[] {
  const attackPatterns = store.patterns(attacker);
  // Priority 1: fours
  const fours = attackPatterns.filter((p) => p.type === "four" || p.type === "open-four");
  if (fours.length > 0) {
    const candidates: Move[] = [];
    for (const p of fours) {
      candidates.push(...p.gains);
      const box = boxCell(p, store.board);
      if (box) candidates.push(box);
    }
    const surviving = survivingBlocks(store.board, defender, attacker, dedupe(candidates));
    return surviving; // empty ⇒ open-four unstoppable (caller treats as win)
  }
  // Priority 2: fork points
  const forks = recognizedForkPoints(attackPatterns, recognizedForkPatterns);
  if (forks.length > 0) {
    const cells: Move[] = [];
    for (const f of forks) {
      for (const p of f.patterns) cells.push(...p.gains);
    }
    return dedupe(cells).filter((m) => store.board[m.row][m.col] === 0);
  }
  // Priority 3: open-three criticalGains
  const cells: Move[] = [];
  for (const p of attackPatterns) {
    if (p.type === "open-three") cells.push(...p.criticalGains);
  }
  return dedupe(cells).filter((m) => store.board[m.row][m.col] === 0);
}

export function findForcedWin(store, attacker, options): ForcedWinResult {
  const recognized = options.recognizedForkPatterns ?? ALL_FORK_PATTERN_NAMES;
  const counter = { count: 0 };
  const pv: Move[] = [];
  const won = attack(store, attacker, options.maxPly, options.deadline ?? null, recognized, counter, pv);
  return { won, principalVariation: won ? pv : [], nodesVisited: counter.count };
}

function attack(...): boolean {
  if (maxPly <= 0) return false;
  if (deadline && Date.now() > deadline) return false;
  for (const move of collectAttackThreatMoves(...)) {
    store.place(move, attacker);
    counter.count++;
    if (checkCaroWin(store.board, move.row, move.col, attacker)) {
      pv.push(move);
      store.undo();
      return true;
    }
    const defence = collectDefenceMoves(store, attacker, other(attacker), recognized);
    if (defence.length === 0) {
      // No defence but also no win ⇒ not a continuing TSS threat; reject branch
      // EXCEPTION: if fours existed and survivingBlocks emptied ⇒ unstoppable
      // Detect via: attacker still has four/open-four after place → success
      const stillFour = store.patterns(attacker).some((p) => p.type === "four" || p.type === "open-four");
      if (stillFour) { pv.push(move); store.undo(); return true; }
      store.undo();
      continue;
    }
    let allRepliesLose = true;
    const lineAfter = [move];
    for (const block of defence) {
      store.place(block, other(attacker));
      counter.count++;
      const replyPv: Move[] = [];
      const stillWins = attack(store, attacker, maxPly - 2, deadline, recognized, counter, replyPv);
      store.undo();
      if (!stillWins) { allRepliesLose = false; break; }
      // keep first successful continuation for PV
      if (allRepliesLose) lineAfter.push(block, ...replyPv);
    }
    store.undo();
    if (allRepliesLose) {
      pv.push(...lineAfter);
      return true;
    }
  }
  return false;
}
```

**PV bookkeeping note:** The sketch above is illustrative — implement cleanly so `principalVariation` is the full alternating line of the first proven win. Prefer pushing on success unwind rather than mutating shared arrays incorrectly across failed branches. Tests only require `pv[0]` correct and `won` accurate; full PV length ≥ 1 is enough for Task 3, full line checked in Task 4.

**Empty defence vs unstoppable:** When attacker has open-four and `survivingBlocks` is empty → `won` for that move. When defence is empty because there was no option-A threat → skip (not forcing).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/engine/threatSearch.spec.ts`
Expected: PASS. Adjust fixtures/coordinates until green; do not weaken assertions to “any move.”

- [ ] **Step 5: Commit**

```bash
git add src/engine/threatSearch.ts src/engine/threatSearch.spec.ts
git commit -m "$(cat <<'EOF'
feat: add threat-space search prover (option A)

EOF
)"
```

---

### Task 4: Wire TSS into `search` (own force + must-block)

**Files:**
- Modify: `src/engine/search.ts`
- Modify: `src/engine/search.spec.ts`

**Interfaces:**
- Consumes: `findForcedWin`, `collectDefenceMoves` from `threatSearch.ts`; `WIN_SCORE` from `evaluate.ts`
- Produces: `search` / `negamaxStrategy` path honors `config.threatSearch`

Behavior when `config.threatSearch === true`:

1. `deadline = now + timeBudgetMs` (if set).
2. `threatOpts = { maxPly: config.threatMaxPly ?? 16, deadline, recognizedForkPatterns: config.recognizedForkPatterns }`.
3. Opponent force: `findForcedWin(store, otherPlayer(player), threatOpts)`.
   - If `won`, compute `collectDefenceMoves` on a trial… simpler approach matching the spec: the opponent’s PV first move is the threat they would play; defence cells are the legal answers **now** to current opponent threats already on the board (before they move) — i.e. call `collectDefenceMoves(store, opponent, player, forks)` on the **current** position (opponent is the “attacker” who already has threats). If that set is non-empty, set root candidates to that set and run `negamaxStrategy` (or `patternOnlyStrategy` if length === 1). If empty but opp `won` was about a future force, fall through to own force / normal search.
4. Own force: `findForcedWin(store, player, threatOpts)`.
   - If `won` and `pv.length > 0`, return:
     ```ts
     {
       move: pv[0],
       score: WIN_SCORE,
       depth: pv.length,
       principalVariation: pv,
       nodesVisited: /* tss nodes + 0 negamax */,
     }
     ```
5. Else existing `narrowCandidates` + strategy path, with the same deadline / remaining time.

Important: TSS must not leave the store dirty — always undo inside `findForcedWin`. After TSS, `store.depth === 0`.

- [ ] **Step 1: Write the failing tests**

Add to `search.spec.ts`:

```ts
describe("threat search integration", () => {
  it("returns the forced winning move when threatSearch is enabled", () => {
    const board = parseBoard(".XXXX.");
    const result = search(board, 1, {
      maxDepth: 2,
      threatSearch: true,
      threatMaxPly: 8,
      recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    });
    expect(Math.abs(result.score)).toBeGreaterThanOrEqual(WIN_SCORE);
    // winning cell is one of the four gains
  });

  it("does not use TSS when threatSearch is false even if a force exists", () => {
    // Behavioral: with threatSearch false and maxDepth 1 on a deeper-only
    // force fixture, may miss. For the immediate four, negamax also finds it —
    // so assert via a fixture where TSS threat set includes a move that
    // patternOnly/quiet would not pick, OR simply assert findForcedWin is
    // the authority and integration only when threatSearch true.
    // Practical assertion: hard profile path (threatSearch false) on the
    // fork fixture still wins via negamax; expert path returns WIN_SCORE
    // with depth === pv length from TSS.
    const board = parseBoard(`
      .......
      .......
      O.XXX..
      .....X.
      .....X.
      .....X.
      .......
    `);
    const withTss = search(board, 1, {
      maxDepth: 1,
      threatSearch: true,
      threatMaxPly: 8,
      recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
      timeBudgetMs: 2000,
    });
    expect(withTss.move).toEqual({ row: 2, col: 5 });
    expect(withTss.score).toBeGreaterThanOrEqual(WIN_SCORE);
  });

  it("must-block when opponent has a forced win", () => {
    // Build a position where opponent (2) has .XXXX. style threat to move
    // if we pass; side to move is 1 and must block.
    // Example: O has four gains; X to move.
    const board = parseBoard(".OOOO."); // player 2 fours — confirm parse uses O=2
    const result = search(board, 1, {
      maxDepth: 4,
      threatSearch: true,
      threatMaxPly: 8,
      recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    });
    const blocks = new Set(["0,0", "0,5"]); // adjust to real gains
    expect(blocks.has(`${result.move.row},${result.move.col}`)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/engine/search.spec.ts -t "threat search"`
Expected: FAIL — `threatSearch` ignored.

- [ ] **Step 3: Implement wiring in `search()`**

Insert the TSS prelude in `search()` after creating `store` / before `narrowCandidates`, using the behavior listed above. Keep `negamaxStrategy` itself unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/engine/search.spec.ts`
Expected: PASS. Full suite: `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/search.ts src/engine/search.spec.ts
git commit -m "$(cat <<'EOF'
feat: run threat-space search before negamax when enabled

EOF
)"
```

---

### Task 5: Longer force fixture + expert vs hard gate

**Files:**
- Modify: `src/engine/threatSearch.spec.ts`
- Modify: `src/engine/engine.spec.ts` or `search.spec.ts`

**Interfaces:**
- Consumes: Task 3–4 APIs
- Produces: regression fixtures proving TSS depth advantage

- [ ] **Step 1: Write the failing tests**

Add a multi-ply force test. Construct by extending an open-three until `findForcedWin` reports `won: true` with `principalVariation.length >= 5` (attacker+defender plies). If a hand-built diagram fails, adjust stones until the prover agrees — the property under test is “TSS proves a force longer than hard’s negamax depth,” not exact ASCII art.

```ts
it("proves a force longer than hard negamax depth", () => {
  const board = parseBoard(`/* diagram */`);
  const store = PatternStore.fromBoard(board);
  const tss = findForcedWin(store, 1, {
    maxPly: 16,
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
  });
  expect(tss.won).toBe(true);
  expect(tss.principalVariation.length).toBeGreaterThanOrEqual(5);

  const hardLike = search(board, 1, {
    maxDepth: 6,
    threatSearch: false,
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    timeBudgetMs: 3000,
  });
  // Either hard misses the winning first move, OR hard finds it but without
  // WIN_SCORE proof. Prefer: winning first move differs OR hard score < WIN_SCORE.
  const expert = search(board, 1, {
    maxDepth: 6,
    threatSearch: true,
    threatMaxPly: 16,
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    timeBudgetMs: 3000,
  });
  expect(expert.move).toEqual(tss.principalVariation[0]);
  expect(expert.score).toBeGreaterThanOrEqual(WIN_SCORE);
});
```

Also:

```ts
it("chooseMove expert enables TSS via DIFFICULTY_PROFILES", () => {
  const cfg = resolveEngineSearchConfig({ difficulty: "expert" });
  expect(cfg.threatSearch).toBe(true);
  const hard = resolveEngineSearchConfig({ difficulty: "hard" });
  expect(hard.threatSearch).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/engine/threatSearch.spec.ts src/engine/search.spec.ts`
Expected: FAIL on the long-force fixture until the diagram is valid / wiring complete.

- [ ] **Step 3: Stabilize the fixture**

Iterate the ASCII board (or build via `placeMove` in the test) until TSS proves the line. Do not change `maxDepth` of hard to make the test pass.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/threatSearch.spec.ts src/engine/search.spec.ts src/engine/engine.spec.ts
git commit -m "$(cat <<'EOF'
test: cover long threat-space forces and expert gate

EOF
)"
```

---

### Task 6: Spec status + original roadmap pointer

**Files:**
- Modify: `docs/superpowers/specs/2026-07-16-gomoku-engine-design.md` (Phase B bullet — one line that Phase B is specified in `2026-07-19-threat-space-search-design.md`)
- Ensure: `docs/superpowers/specs/2026-07-19-threat-space-search-design.md` status stays `approved design` (already)

- [ ] **Step 1: Edit roadmap line**

In the original design, under Phase B, add: “Detailed design: `2026-07-19-threat-space-search-design.md` (expert-gated, option A).”

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-16-gomoku-engine-design.md docs/superpowers/specs/2026-07-19-threat-space-search-design.md docs/superpowers/plans/2026-07-19-threat-space-search.md
git commit -m "$(cat <<'EOF'
docs: add threat-space search design and implementation plan

EOF
)"
```

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Option A threat set | Task 3 |
| Defence priority fours → forks → open-three | Task 3 |
| `findForcedWin` AND/OR + maxPly/deadline | Task 3 |
| Unified `DIFFICULTY_PROFILES` | Task 1 |
| `expert` difficulty + UI | Task 1 |
| TSS before negamax; fallback | Task 4 |
| Opponent must-block | Task 4 |
| easy/medium/hard unchanged | Task 1 + 5 |
| Long force / expert vs hard | Task 5 |
| PatternStore place/undo only | Task 3–4 |
| No TT / option B / LLM bridge | Global constraints |

## Placeholder scan

None intentional. Fixture coordinates in Task 3–5 may need a one-line adjust after first Jest run against real `parseBoard` indices — that is expected calibration, not a TBD feature.
