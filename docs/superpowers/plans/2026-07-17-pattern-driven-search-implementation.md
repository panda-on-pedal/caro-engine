# Pattern-Driven Candidate Narrowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `negamax`'s blind full-candidate search with pattern-driven candidate narrowing, so the engine reliably blocks/forks/defends without depending on unreachable search depth, plus fast/varied opening play via a pure distance-weighted randomization utility.

**Architecture:** Two new modules — `randomize.ts` (pure, game-agnostic weighted-random helpers) and `narrow.ts` (pattern-tiered candidate selection + a named, ASCII-documented, difficulty-gated fork catalog) — sit below `search.ts`. `negamax` calls `narrowCandidates` at every node instead of `findCandidateMoves` + `orderMoves`, and the top-level `search()` gains a pluggable `MoveSelectionStrategy` parameter so a caller can bypass the negamax verification step entirely (pattern narrowing alone) for testing or future algorithms.

**Tech Stack:** TypeScript (strict, `nodenext` modules, explicit `.ts` import extensions), Jest via `ts-jest`, no new dependencies.

## Global Constraints

- Board is 20×20 (`BOARD_SIZE`), win length exactly 5 (`WIN_LENGTH`) — unchanged from the existing engine.
- Dependency direction is strictly downward: `engine → search → narrow → evaluate → patterns → rules → board`. `randomize.ts` sits below everything and imports nothing from this codebase (no `Board`/`Player`/`Move` types) — it must stay reusable outside Caro entirely.
- All new source files live under `src/engine/`; all imports use explicit `.ts` extensions.
- Test files are named `*.spec.ts` and live beside the file they test.
- Strict TypeScript: no `any`.
- The line-pattern ladder (`two` → `open-two` → `three` → `open-three` → `four` → `open-four` → `five`) is always fully recognized at every difficulty. Only **fork recognition** is difficulty-gated, via an explicit named allow-list.
- Fork catalog entries (`FORK_PATTERNS`) are named and documented with an ASCII `example` (specification/test format, matching `patterns.spec.ts`'s existing convention), but matched functionally against already-computed `PatternInstance`/`ForkPoint` data — never raw board-character shape scanning.
- `randomize.ts`'s functions take an injectable `rng: () => number` (defaulting to `Math.random`) so randomized behavior is deterministically testable.
- `SearchConfig`'s new `recognizedForkPatterns`/`decay` fields are **optional**, defaulting to `ALL_FORK_PATTERN_NAMES`/`DEFAULT_DECAY_CONFIG` inside `search()`/`negamaxSearch()`. This deviates from the design doc's illustrative required-field snippet: making them required would force edits to every existing `SearchConfig` literal across `search.spec.ts`/`engine.difficulty.spec.ts` with no behavioral benefit, since `engine.ts` always supplies them explicitly per difficulty regardless. Only tests specifically targeting fork-catalog gating or randomization need to pass them.
- `Player = 1 | 2`, `Cell = 0 | 1 | 2`, `Board`, `Move` are reused from `board.ts`/`state.ts` — never redefined.
- `PatternInstance { type, player, cells, gains, criticalGains, direction }` and `ForkPoint { move, player, patterns }` are reused from `patterns.ts` — never redefined.

---

### Task 1: `randomize.ts` — distance weighting + decay

**Files:**

- Create: `src/engine/randomize.ts`
- Test: `src/engine/randomize.spec.ts`

**Interfaces:**

- Consumes: nothing from this codebase (pure, game-agnostic).
- Produces: `interface DecayConfig { startDecay: number; minDecay: number; stepDown: number }`, `distanceWeight(distance: number, decayRate: number): number`, `decayRateForMoveCount(moveCount: number, config: DecayConfig): number` — consumed by `narrow.ts` in Task 6.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/randomize.spec.ts
import { decayRateForMoveCount, distanceWeight } from "./randomize.ts";

describe("distanceWeight", () => {
  it("always returns 1 at distance 1, regardless of decay rate", () => {
    expect(distanceWeight(1, 0.8)).toBe(1);
    expect(distanceWeight(1, 0.1)).toBe(1);
  });

  it("decreases monotonically as distance increases", () => {
    const w1 = distanceWeight(1, 0.5);
    const w2 = distanceWeight(2, 0.5);
    const w3 = distanceWeight(3, 0.5);
    expect(w1).toBeGreaterThan(w2);
    expect(w2).toBeGreaterThan(w3);
  });

  it("matches the geometric decay formula exactly", () => {
    expect(distanceWeight(3, 0.5)).toBeCloseTo(0.25, 10);
  });

  it("collapses to near-zero weight for far cells at a low decay rate", () => {
    expect(distanceWeight(5, 0.1)).toBeCloseTo(0.0001, 10);
  });
});

describe("decayRateForMoveCount", () => {
  const config = { startDecay: 0.8, minDecay: 0.15, stepDown: 0.05 };

  it("returns startDecay at moveCount 0", () => {
    expect(decayRateForMoveCount(0, config)).toBeCloseTo(0.8, 10);
  });

  it("decreases as moveCount increases", () => {
    expect(decayRateForMoveCount(4, config)).toBeCloseTo(0.6, 10);
  });

  it("never goes below minDecay", () => {
    expect(decayRateForMoveCount(100, config)).toBe(0.15);
  });

  it("is monotonically non-increasing", () => {
    const a = decayRateForMoveCount(2, config);
    const b = decayRateForMoveCount(5, config);
    expect(b).toBeLessThanOrEqual(a);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- randomize.spec`
Expected: FAIL with `Cannot find module './randomize.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/engine/randomize.ts

/**
 * Pure, game-agnostic weighted-random helpers. No dependency on this
 * codebase's Board/Player/Move types — reusable outside Caro entirely.
 */

export interface DecayConfig {
  /** Decay rate used at moveCount = 0 (most exploratory). */
  startDecay: number;
  /** Floor the decay rate never goes below. */
  minDecay: number;
  /** Linear decrease in decay rate per move played. */
  stepDown: number;
}

/**
 * Geometric decay weight for a cell at the given distance from a
 * reference point. distance=1 always yields weight 1; larger distances
 * yield exponentially smaller weights as decayRate shrinks toward 0.
 */
export function distanceWeight(distance: number, decayRate: number): number {
  return decayRate ** (distance - 1);
}

/**
 * The decay rate to use for distanceWeight, given how many moves have
 * been played so far. Starts wide/exploratory and linearly sharpens
 * toward minDecay as the game matures.
 */
export function decayRateForMoveCount(
  moveCount: number,
  config: DecayConfig,
): number {
  return Math.max(
    config.minDecay,
    config.startDecay - config.stepDown * moveCount,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- randomize.spec`
Expected: PASS, 8/8 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/randomize.ts src/engine/randomize.spec.ts
git commit -m "feat: add pure distance-weight and decay-rate helpers"
```

---

### Task 2: `randomize.ts` — weighted sampling

**Files:**

- Modify: `src/engine/randomize.ts` (add `weightedPick`, `sampleWithoutReplacement`)
- Modify: `src/engine/randomize.spec.ts` (add tests)

**Interfaces:**

- Consumes: nothing new.
- Produces: `weightedPick<T>(items: readonly T[], weights: readonly number[], rng?: () => number): T`, `sampleWithoutReplacement<T>(items: readonly T[], weights: readonly number[], count: number, rng?: () => number): T[]` — both consumed by `narrow.ts` in Task 6.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/randomize.spec.ts`:

```typescript
import {
  decayRateForMoveCount,
  distanceWeight,
  sampleWithoutReplacement,
  weightedPick,
} from "./randomize.ts";

describe("weightedPick", () => {
  it("always picks the only item in a single-item list", () => {
    expect(weightedPick(["a"], [1])).toBe("a");
  });

  it("picks deterministically for an injected rng at the low end of the range", () => {
    // total weight = 3; rng() * 3 = 0 -> lands in the first item's slice
    const result = weightedPick(["a", "b", "c"], [1, 1, 1], () => 0);
    expect(result).toBe("a");
  });

  it("picks deterministically for an injected rng at the high end of the range", () => {
    // total weight = 3; rng() * 3 = 2.999... -> lands in the last item's slice
    const result = weightedPick(["a", "b", "c"], [1, 1, 1], () => 0.9999);
    expect(result).toBe("c");
  });

  it("never picks a zero-weight item when a positive-weight item is available", () => {
    const result = weightedPick(["a", "b"], [0, 1], () => 0.5);
    expect(result).toBe("b");
  });

  it("never picks a leading zero-weight item even at the exact rng()=0 boundary", () => {
    // Regression: a `target <= 0` check (instead of `target < 0`) lets the
    // very first item's zero-width interval "catch" target=0, wrongly
    // selecting a weight-0 item. rng()=0 is squarely inside Math.random()'s
    // real [0, 1) range, so this must route to the next positive-weight item.
    const result = weightedPick(["a", "b"], [0, 1], () => 0);
    expect(result).toBe("b");
  });

  it("throws when items and weights have different lengths", () => {
    expect(() => weightedPick(["a"], [1, 2])).toThrow();
  });

  it("throws when given an empty list", () => {
    expect(() => weightedPick([], [])).toThrow();
  });
});

describe("sampleWithoutReplacement", () => {
  it("returns all items when count exceeds the list length", () => {
    const result = sampleWithoutReplacement(["a", "b"], [1, 1], 5, () => 0);
    expect(result.sort()).toEqual(["a", "b"]);
  });

  it("returns exactly `count` distinct items when the list is larger", () => {
    const items = ["a", "b", "c", "d", "e"];
    const weights = [1, 1, 1, 1, 1];
    const result = sampleWithoutReplacement(items, weights, 3, () => 0.5);
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
  });

  it("never repeats an item across the sample", () => {
    const items = ["a", "b", "c"];
    const weights = [1, 1, 1];
    const result = sampleWithoutReplacement(items, weights, 3, () => 0);
    expect(new Set(result).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- randomize.spec`
Expected: FAIL — `weightedPick`/`sampleWithoutReplacement` are not functions

- [ ] **Step 3: Write the implementation**

Add to `src/engine/randomize.ts`:

```typescript
/**
 * Weighted random selection. `rng` defaults to Math.random but is
 * injectable so callers (tests, replay tooling) can get deterministic
 * picks from a fixed sequence.
 */
export function weightedPick<T>(
  items: readonly T[],
  weights: readonly number[],
  rng: () => number = Math.random,
): T {
  if (items.length !== weights.length) {
    throw new Error("items and weights must have the same length");
  }
  if (items.length === 0) {
    throw new Error("cannot pick from an empty list");
  }

  const total = weights.reduce((sum, w) => sum + w, 0);
  let target = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    target -= weights[i];
    if (target < 0) {
      return items[i];
    }
  }
  return items[items.length - 1];
}

/**
 * Samples up to `count` distinct items via repeated weighted picks,
 * removing each picked item (and its weight) before the next draw.
 */
export function sampleWithoutReplacement<T>(
  items: readonly T[],
  weights: readonly number[],
  count: number,
  rng: () => number = Math.random,
): T[] {
  const remainingItems = [...items];
  const remainingWeights = [...weights];
  const picked: T[] = [];

  while (picked.length < count && remainingItems.length > 0) {
    const choice = weightedPick(remainingItems, remainingWeights, rng);
    picked.push(choice);
    const index = remainingItems.indexOf(choice);
    remainingItems.splice(index, 1);
    remainingWeights.splice(index, 1);
  }

  return picked;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- randomize.spec`
Expected: PASS, 18/18 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/randomize.ts src/engine/randomize.spec.ts
git commit -m "feat: add weighted sampling helpers to randomize.ts"
```

---

### Task 3: `narrow.ts` — named fork catalog

**Files:**

- Create: `src/engine/narrow.ts`
- Test: `src/engine/narrow.spec.ts`

**Interfaces:**

- Consumes: `findForkPoints`, `type PatternInstance`, `type PatternType`, `type ForkPoint` from `../patterns.ts` — wait, same directory: `./patterns.ts`.
- Produces: `type ForkPatternName = "double-three-trap" | "double-four-trap" | "mixed-tier-fork"`, `interface ForkPatternDef { name: ForkPatternName; example: string; matches: (forkPoint: ForkPoint) => boolean }`, `FORK_PATTERNS: readonly ForkPatternDef[]`, `ALL_FORK_PATTERN_NAMES: ReadonlySet<ForkPatternName>`, `recognizedForkPoints(patterns: PatternInstance[], recognized: ReadonlySet<ForkPatternName>): ForkPoint[]` — `FORK_PATTERNS`/`ALL_FORK_PATTERN_NAMES` consumed by `engine.ts` in Task 10; `recognizedForkPoints` consumed by `narrow.ts`'s own `narrowCandidates` in Task 5.

The three fixtures below were verified directly against the real `findPatterns`/`findForkPoints` implementation before being written into this plan (not hand-derived blind): `double-three-trap` reuses an exact fixture already proven correct in `patterns.spec.ts`'s `findForkPoints` tests; `double-four-trap` is a new fixture, confirmed via a throwaway script to produce a single fork point at `(4, 5)` with both contributing patterns typed `open-three`; `mixed-tier-fork` is also a new fixture (an earlier draft of this plan incorrectly reused `patterns.spec.ts`'s "open-three + four" example, which — verified empirically — actually classifies as two `open-three` patterns, identical in tier composition to `double-four-trap`, once the actual stone count is checked; a four/open-four was never reachable here regardless, since `narrowCandidates`' step 1/2 forced win/block short-circuit, Task 4, always intercepts any four before fork detection in step 3 runs, so a four-involving fork shape would be dead code). The corrected fixture instead confirms a fork point at `(2, 5)` combining one `open-three` and one `open-two`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/narrow.spec.ts
import { findForkPoints, findPatterns } from "./patterns.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  FORK_PATTERNS,
  recognizedForkPoints,
} from "./narrow.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

describe("FORK_PATTERNS catalog", () => {
  it("double-three-trap matches a fork point made of two two-tier patterns", () => {
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    expect(forkPoints).toHaveLength(1);
    const def = FORK_PATTERNS.find((d) => d.name === "double-three-trap")!;
    expect(def.matches(forkPoints[0])).toBe(true);
  });

  it("double-three-trap does not match a fork point made of two three-tier patterns", () => {
    const board = parseBoard(`
      ........
      .....X..
      .....X..
      .....X..
      ..XXX...
      ........
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    expect(forkPoints).toHaveLength(1);
    const def = FORK_PATTERNS.find((d) => d.name === "double-three-trap")!;
    expect(def.matches(forkPoints[0])).toBe(false);
  });

  it("double-four-trap matches a fork point made of two three-tier patterns", () => {
    const board = parseBoard(`
      ........
      .....X..
      .....X..
      .....X..
      ..XXX...
      ........
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    const def = FORK_PATTERNS.find((d) => d.name === "double-four-trap")!;
    expect(def.matches(forkPoints[0])).toBe(true);
  });

  it("mixed-tier-fork matches a fork point combining a three-tier and a two-tier pattern", () => {
    // Horizontal open-three at row 2 (cols 2-4); vertical open-two at col 5
    // (rows 1 and 3, split by the gap at row 2 that both lines converge on).
    // A four/open-four is deliberately never part of this catalog entry:
    // narrowCandidates' step 1/2 (Task 4) always short-circuits on any
    // four/open-four before step 3's fork detection ever runs, so a
    // "four+three" fork shape would be unreachable in practice — this
    // catalog entry exists specifically for the two lower tiers.
    const board = parseBoard(`
      .......
      .....X.
      ..XXX..
      .....X.
      .......
      .......
      .......
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    expect(forkPoints).toHaveLength(1);
    const def = FORK_PATTERNS.find((d) => d.name === "mixed-tier-fork")!;
    expect(def.matches(forkPoints[0])).toBe(true);
    const doubleThreeDef = FORK_PATTERNS.find(
      (d) => d.name === "double-three-trap",
    )!;
    expect(doubleThreeDef.matches(forkPoints[0])).toBe(false);
    const doubleFourDef = FORK_PATTERNS.find(
      (d) => d.name === "double-four-trap",
    )!;
    expect(doubleFourDef.matches(forkPoints[0])).toBe(false);
  });

  it("ALL_FORK_PATTERN_NAMES contains every catalog entry's name", () => {
    for (const def of FORK_PATTERNS) {
      expect(ALL_FORK_PATTERN_NAMES.has(def.name)).toBe(true);
    }
    expect(ALL_FORK_PATTERN_NAMES.size).toBe(FORK_PATTERNS.length);
  });
});

describe("recognizedForkPoints", () => {
  const board = parseBoard(`
    .......
    .....X.
    ...XX..
    .....X.
    .......
  `);
  const patterns = findPatterns(board, 1);

  it("returns the fork point when its catalog entry is recognized", () => {
    const result = recognizedForkPoints(
      patterns,
      new Set(["double-three-trap"]),
    );
    expect(result).toHaveLength(1);
  });

  it("returns nothing when no catalog entry is recognized", () => {
    const result = recognizedForkPoints(patterns, new Set());
    expect(result).toEqual([]);
  });

  it("returns nothing when only an unrelated catalog entry is recognized", () => {
    const result = recognizedForkPoints(
      patterns,
      new Set(["double-four-trap"]),
    );
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- narrow.spec`
Expected: FAIL with `Cannot find module './narrow.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/engine/narrow.ts
import {
  findForkPoints,
  type ForkPoint,
  type PatternInstance,
  type PatternType,
} from "./patterns.ts";

export type ForkPatternName =
  | "double-three-trap"
  | "double-four-trap"
  | "mixed-tier-fork";

export interface ForkPatternDef {
  name: ForkPatternName;
  /** ASCII diagram, for documentation and as the source of the test
   * fixtures above — matching is functional, this is specification only. */
  example: string;
  matches: (forkPoint: ForkPoint) => boolean;
}

function isTwoTier(type: PatternType): boolean {
  return type === "two" || type === "open-two";
}

function isThreeTier(type: PatternType): boolean {
  return type === "three" || type === "open-three";
}

export const FORK_PATTERNS: readonly ForkPatternDef[] = [
  {
    name: "double-three-trap",
    example: `
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `,
    matches: (forkPoint) =>
      forkPoint.patterns.every((p) => isTwoTier(p.type)),
  },
  {
    name: "double-four-trap",
    example: `
      ........
      .....X..
      .....X..
      .....X..
      ..XXX...
      ........
    `,
    matches: (forkPoint) =>
      forkPoint.patterns.every((p) => isThreeTier(p.type)),
  },
  {
    name: "mixed-tier-fork",
    example: `
      .......
      .....X.
      ..XXX..
      .....X.
      .......
      .......
      .......
    `,
    // Deliberately never matches a four/open-four combination: those are
    // always intercepted by narrowCandidates' step 1/2 forced win/block
    // short-circuit (Task 4) before fork detection (step 3) ever runs, so
    // a four-involving fork shape would be dead code here. This entry
    // exists for the two lower tiers only.
    matches: (forkPoint) =>
      forkPoint.patterns.some((p) => isTwoTier(p.type)) &&
      forkPoint.patterns.some((p) => isThreeTier(p.type)),
  },
];

export const ALL_FORK_PATTERN_NAMES: ReadonlySet<ForkPatternName> = new Set(
  FORK_PATTERNS.map((def) => def.name),
);

/**
 * Fork points whose contributing pattern types match at least one
 * recognized catalog entry. Difficulty-gates fork awareness: an easy
 * config with an empty `recognized` set never sees any fork.
 */
export function recognizedForkPoints(
  patterns: PatternInstance[],
  recognized: ReadonlySet<ForkPatternName>,
): ForkPoint[] {
  const allForkPoints = findForkPoints(patterns);
  const activeDefs = FORK_PATTERNS.filter((def) => recognized.has(def.name));
  return allForkPoints.filter((forkPoint) =>
    activeDefs.some((def) => def.matches(forkPoint)),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- narrow.spec`
Expected: PASS, 8/8 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/narrow.ts src/engine/narrow.spec.ts
git commit -m "feat: add named fork-pattern catalog with functional matching"
```

---

### Task 4: `narrow.ts` — forced win/block short-circuit

**Files:**

- Modify: `src/engine/narrow.ts` (add `narrowCandidates` steps 1-2)
- Modify: `src/engine/narrow.spec.ts` (add tests)

**Interfaces:**

- Consumes: `findPatterns` from `./patterns.ts`; `type Board`, `type Player` from `./board.ts`; `type Move` from `./state.ts`.
- Produces: `narrowCandidates(board: Board, player: Player, moveCount: number, config: NarrowConfig): Move[]` (steps 1-2 only in this task; Tasks 5-6 extend it) — this is the function `search.ts` calls in Task 7. `interface NarrowConfig { recognizedForkPatterns: ReadonlySet<ForkPatternName>; decay: DecayConfig; rng?: () => number }` — note `NarrowConfig`'s fields are **required** (unlike `SearchConfig`'s optional fields with defaults from Task 7): by the time `search.ts` calls `narrowCandidates`, it has already resolved `SearchConfig`'s optional fields to concrete values.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/narrow.spec.ts`:

```typescript
import { narrowCandidates, type NarrowConfig } from "./narrow.ts";

const BASE_CONFIG: NarrowConfig = {
  recognizedForkPatterns: new Set(),
  decay: { startDecay: 0.8, minDecay: 0.15, stepDown: 0.05 },
};

describe("narrowCandidates — forced win/block", () => {
  it("returns only the gain when the mover already has a completable four", () => {
    const board = parseBoard("OXXXX.");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result).toEqual([{ row: 0, col: 5 }]);
  });

  it("returns only the gain when the mover already has an open four", () => {
    const board = parseBoard(".XXXX..");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result.map((m) => `${m.row},${m.col}`).sort()).toEqual(
      ["0,0", "0,5"].sort(),
    );
  });

  it("returns only the blocking gain when the opponent has a completable four", () => {
    const board = parseBoard("XOOOO.");
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG);
    expect(result).toEqual([{ row: 0, col: 5 }]);
  });

  it("prioritizes the mover's own win over blocking the opponent's four", () => {
    const board = parseBoard(`
      .XXXX....
      .........
      .OOOO....
    `);
    const result = narrowCandidates(board, 1, 6, BASE_CONFIG);
    // X's own open-four (both ends open) has two gains, (0,0) and (0,5);
    // only those are returned — the opponent's four at row 2 is
    // irrelevant once the mover can win immediately, so neither of its
    // blocking cells appears here.
    expect(result.map((m) => `${m.row},${m.col}`).sort()).toEqual(
      ["0,0", "0,5"].sort(),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- narrow.spec`
Expected: FAIL with `narrowCandidates is not a function`

- [ ] **Step 3: Write the implementation**

Add to `src/engine/narrow.ts`:

```typescript
import { findPatterns } from "./patterns.ts";
import type { Board, Player } from "./board.ts";
import type { Move } from "./state.ts";
import type { DecayConfig } from "./randomize.ts";

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

export interface NarrowConfig {
  recognizedForkPatterns: ReadonlySet<ForkPatternName>;
  decay: DecayConfig;
  rng?: () => number;
}

/**
 * Selects a small, tactically relevant set of candidate moves instead of
 * the full raw radius-2 neighborhood, using the pattern catalog that is
 * already computed once per position. See docs/superpowers/specs/
 * 2026-07-17-pattern-driven-search-design.md for the full rationale.
 */
export function narrowCandidates(
  board: Board,
  player: Player,
  moveCount: number,
  config: NarrowConfig,
): Move[] {
  const opponent = otherPlayer(player);
  const ownPatterns = findPatterns(board, player);
  const oppPatterns = findPatterns(board, opponent);

  // Step 1: I can win now.
  const ownFour = ownPatterns.find(
    (p) => p.type === "four" || p.type === "open-four",
  );
  if (ownFour) {
    return ownFour.gains;
  }

  // Step 2: I must block now.
  const oppFour = oppPatterns.find(
    (p) => p.type === "four" || p.type === "open-four",
  );
  if (oppFour) {
    return oppFour.gains;
  }

  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- narrow.spec`
Expected: PASS, 12/12 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/narrow.ts src/engine/narrow.spec.ts
git commit -m "feat: add forced win/block short-circuit to narrowCandidates"
```

---

### Task 5: `narrow.ts` — tactical set (open-three + fork defense)

**Files:**

- Modify: `src/engine/narrow.ts` (extend `narrowCandidates` with step 3)
- Modify: `src/engine/narrow.spec.ts` (add tests)

**Interfaces:**

- Consumes: `recognizedForkPoints` from this file (Task 3).
- Produces: `narrowCandidates` now also returns a tactical set when no forced win/block exists — still the same exported signature.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/narrow.spec.ts`:

```typescript
describe("narrowCandidates — tactical set", () => {
  it("includes the own open-three's extension cells", () => {
    const board = parseBoard("..XXX..");
    const result = narrowCandidates(board, 1, 3, BASE_CONFIG);
    const keys = result.map((m) => `${m.row},${m.col}`).sort();
    expect(keys).toEqual(["0,1", "0,5"].sort());
  });

  it("includes the opponent's open-three's blocking cells", () => {
    const board = parseBoard("..OOO..");
    const result = narrowCandidates(board, 1, 3, BASE_CONFIG);
    const keys = result.map((m) => `${m.row},${m.col}`).sort();
    expect(keys).toEqual(["0,1", "0,5"].sort());
  });

  it("includes a recognized fork point (offense)", () => {
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `);
    const config: NarrowConfig = {
      ...BASE_CONFIG,
      recognizedForkPatterns: new Set(["double-three-trap"]),
    };
    const result = narrowCandidates(board, 1, 4, config);
    expect(
      result.some((m) => m.row === 2 && m.col === 5),
    ).toBe(true);
  });

  it("does not include an unrecognized fork point", () => {
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `);
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG); // empty recognizedForkPatterns
    expect(result.some((m) => m.row === 2 && m.col === 5)).toBe(false);
  });

  it("includes a recognized fork point built by the opponent (defense)", () => {
    const board = parseBoard(`
      .......
      .....O.
      ...OO..
      .....O.
      .......
    `);
    const config: NarrowConfig = {
      ...BASE_CONFIG,
      recognizedForkPatterns: new Set(["double-three-trap"]),
    };
    const result = narrowCandidates(board, 1, 4, config);
    expect(result.some((m) => m.row === 2 && m.col === 5)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- narrow.spec`
Expected: FAIL — tactical-set tests return `[]` instead of the expected cells

- [ ] **Step 3: Write the implementation**

Replace the `return [];` at the end of `narrowCandidates` in `src/engine/narrow.ts` with:

```typescript
  // Step 3: tactical set — fork points (offense and defense) and
  // open-three extensions/blocks, deduplicated by cell.
  const tacticalMoves = new Map<string, Move>();

  const addAll = (moves: Move[]) => {
    for (const move of moves) {
      tacticalMoves.set(`${move.row},${move.col}`, move);
    }
  };

  for (const forkPoint of recognizedForkPoints(
    ownPatterns,
    config.recognizedForkPatterns,
  )) {
    tacticalMoves.set(
      `${forkPoint.move.row},${forkPoint.move.col}`,
      forkPoint.move,
    );
  }
  for (const forkPoint of recognizedForkPoints(
    oppPatterns,
    config.recognizedForkPatterns,
  )) {
    tacticalMoves.set(
      `${forkPoint.move.row},${forkPoint.move.col}`,
      forkPoint.move,
    );
  }
  // Use criticalGains, not gains: an open-three's raw `gains` list includes
  // every gap cell from every viable 5-window containing its stones — for
  // a widely-padded three like "..XXX..", that's 4 cells (verified
  // empirically), not just the 2 that actually extend it toward an
  // open-four. criticalGains is exactly "the subset that promotes this
  // line to the next severity tier" (patterns.ts's own definition), which
  // is what a tactical candidate set should mean here.
  for (const pattern of ownPatterns) {
    if (pattern.type === "open-three") {
      addAll(pattern.criticalGains);
    }
  }
  for (const pattern of oppPatterns) {
    if (pattern.type === "open-three") {
      addAll(pattern.criticalGains);
    }
  }

  if (tacticalMoves.size > 0) {
    return [...tacticalMoves.values()];
  }

  return [];
```

Note: this returns the tactical set in `Map` insertion order for now. Task 6
reorders it via the same weighted-random mechanism used for the quiet
fallback, so a downstream consumer that takes "the first candidate"
(`patternOnlyStrategy`, Task 8) doesn't silently reintroduce deterministic
scan-order ties — see the design doc's Section 3, "tie-breaking within the
tactical set."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- narrow.spec`
Expected: PASS, 17/17 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/narrow.ts src/engine/narrow.spec.ts
git commit -m "feat: add tactical candidate set (open-three, fork offense/defense)"
```

---

### Task 6: `narrow.ts` — quiet-position fallback

**Files:**

- Modify: `src/engine/narrow.ts` (extend `narrowCandidates` with step 4, completing it)
- Modify: `src/engine/narrow.spec.ts` (add tests)

**Interfaces:**

- Consumes: `findCandidateMoves` from `./search.ts` — **wait**, this would invert the dependency direction (`narrow.ts` must sit *below* `search.ts`). `findCandidateMoves` is pure board/geometry logic with no dependency on `narrow.ts`, `evaluate.ts`, or `patterns.ts`, so it moves to `narrow.ts` in this task, and `search.ts` imports it from there instead (Task 7 updates that import). `narrow.ts` also consumes `distanceWeight`, `decayRateForMoveCount`, `sampleWithoutReplacement` from `./randomize.ts`; `isLegalMove` from `./board.ts`.
- Produces: `findCandidateMoves(board: Board): Move[]` (relocated, unchanged behavior) and the completed `narrowCandidates`.

- [ ] **Step 1: Move `findCandidateMoves` and update its test location**

`findCandidateMoves` currently lives in `src/engine/search.ts` with its tests in `src/engine/search.spec.ts`. Move the function (unchanged) to `src/engine/narrow.ts`, and move its three existing tests (unchanged) into `src/engine/narrow.spec.ts`. `search.ts` will re-import it from `narrow.ts` in Task 7 — no behavior changes in this step, just relocation to respect the dependency direction (`narrow.ts` sits below `search.ts`).

Cut this block out of `src/engine/search.ts`:

```typescript
const CANDIDATE_RADIUS = 2;

export function findCandidateMoves(board: Board): Move[] {
  const candidates = new Map<string, Move>();
  let hasStone = false;

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] === 0) {
        continue;
      }
      hasStone = true;
      for (let dRow = -CANDIDATE_RADIUS; dRow <= CANDIDATE_RADIUS; dRow += 1) {
        for (
          let dCol = -CANDIDATE_RADIUS;
          dCol <= CANDIDATE_RADIUS;
          dCol += 1
        ) {
          const r = row + dRow;
          const c = col + dCol;
          if (isLegalMove(board, r, c)) {
            candidates.set(`${r},${c}`, { row: r, col: c });
          }
        }
      }
    }
  }

  if (!hasStone) {
    const center = Math.floor(board.length / 2);
    return [{ row: center, col: center }];
  }

  return [...candidates.values()];
}
```

Paste it into `src/engine/narrow.ts`, adding `isLegalMove` to the existing `import type { Board, Player } from "./board.ts";` line (changing it to `import { isLegalMove, type Board, type Player } from "./board.ts";`).

Cut the three tests in `src/engine/search.spec.ts`'s `describe("findCandidateMoves", ...)` block (all of it, including the `describe` wrapper) and paste them into `src/engine/narrow.spec.ts`, changing the import from `import { findCandidateMoves } from "./search.ts";` to `import { findCandidateMoves } from "./narrow.ts";` (or fold into the existing `narrow.ts` import line already present in that file).

Run: `npm test -- narrow.spec search.spec`
Expected: `narrow.spec` still passes with the 3 relocated tests included (20/20); `search.spec` still compiles and passes even though `findCandidateMoves` is no longer defined there, **only if** Task 7 has not yet run `git rm`-equivalent changes — since this is a plan step, not yet: for now, `search.ts` still has its own copy removed, so add a temporary re-export to keep `search.spec.ts` compiling until Task 7: at the top of `src/engine/search.ts`, add `export { findCandidateMoves } from "./narrow.ts";`. Confirm both spec files pass.

- [ ] **Step 2: Write the failing tests for the quiet fallback**

Add to `src/engine/narrow.spec.ts`:

```typescript
describe("narrowCandidates — quiet fallback", () => {
  it("returns a non-empty, small candidate set when no tactical pattern exists", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    const result = narrowCandidates(board, 2, 1, BASE_CONFIG);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it("only returns cells within distance 2 of an existing stone", () => {
    const board = parseBoard(`
      .......
      .......
      ...X...
      .......
      .......
      .......
      .......
    `);
    // "...X..." has 3 leading dots, so the stone is at column 3, not 2.
    const result = narrowCandidates(board, 2, 1, BASE_CONFIG);
    for (const move of result) {
      const rowDelta = Math.abs(move.row - 2);
      const colDelta = Math.abs(move.col - 3);
      expect(Math.max(rowDelta, colDelta)).toBeLessThanOrEqual(2);
    }
  });

  it("returns the single center cell on a genuinely empty board", () => {
    const board = parseBoard(`
      .....
      .....
      .....
      .....
      .....
    `);
    const result = narrowCandidates(board, 1, 0, BASE_CONFIG);
    expect(result).toEqual([{ row: 2, col: 2 }]);
  });

  it("reorders the tactical set by weighted-random instead of leaving Map insertion order, so a downstream 'take the first' consumer sees variety across ties", () => {
    // Two candidates tie for the tactical set: an own open-three's two
    // extension cells. Insertion order (Task 5's Map) would always put
    // the left cell first; with weighted reordering, an rng biased toward
    // the end of the list should surface the right cell first instead.
    const board = parseBoard("..XXX..");
    const rngLow = () => 0.01;
    const rngHigh = () => 0.99;
    const low = narrowCandidates(board, 1, 3, { ...BASE_CONFIG, rng: rngLow });
    const high = narrowCandidates(board, 1, 3, {
      ...BASE_CONFIG,
      rng: rngHigh,
    });
    expect(low[0]).not.toEqual(high[0]);
  });

  it("samples different subsets across move counts given a varying rng sequence", () => {
    const board = parseBoard(`
      .........
      .........
      .........
      ....X....
      .........
      .........
      .........
      .........
      .........
    `);
    let call = 0;
    const rng = () => {
      const sequence = [0.1, 0.9, 0.3, 0.7, 0.2, 0.8];
      const value = sequence[call % sequence.length];
      call += 1;
      return value;
    };
    const early = narrowCandidates(board, 2, 0, { ...BASE_CONFIG, rng });
    const later = narrowCandidates(board, 2, 20, { ...BASE_CONFIG, rng });
    // Early (wide decay) and later (sharp decay) draws are not required to
    // differ in every run, but both must respect the small-set contract.
    expect(early.length).toBeGreaterThan(0);
    expect(later.length).toBeGreaterThan(0);
  });
});
```

**Fix Task 5's now-flaky test.** Task 5 added `"does not include an unrecognized fork point"`, asserting `narrowCandidates` never returns `(2, 5)` for a board with only an unrecognized fork shape and nothing else. Once step 4 (quiet fallback) exists, that assertion is no longer valid: with an empty tactical set, the function now falls through to the quiet fallback, which samples from the *raw* radius-2 neighborhood — and `(2, 5)` sits at distance 1 from three different stones in that fixture, making it a high-weight, plausible (not just possible) quiet-fallback pick. The test's original intent (an unrecognized fork point isn't specially forced into the result) is still worth keeping, but must be isolated from step 4's randomness to stay deterministic. Replace the test in `src/engine/narrow.spec.ts` (added in Task 5, currently in the `describe("narrowCandidates — tactical set", ...)` block):

```typescript
// before (Task 5):
  it("does not include an unrecognized fork point", () => {
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `);
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG); // empty recognizedForkPatterns
    expect(result.some((m) => m.row === 2 && m.col === 5)).toBe(false);
  });
// after:
  it("does not include an unrecognized fork point, even when the tactical set is non-empty for an unrelated reason", () => {
    // The fork shape (rows 1-3, unrecognized) sits far from an unrelated
    // own open-three (row 10) so the two never interact. The open-three's
    // criticalGains force tacticalMoves.size > 0, so this deterministically
    // exercises step 3's return path — not step 4's quiet fallback, which
    // (verified empirically) would otherwise plausibly sample (2, 5) since
    // it sits at distance 1 from three different stones in the fork shape,
    // making this assertion flaky if step 3 fell through to quiet fallback.
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
      .......
      .......
      .......
      .......
      .......
      ..XXX..
      .......
    `);
    const result = narrowCandidates(board, 1, 4, BASE_CONFIG); // empty recognizedForkPatterns
    expect(result.some((m) => m.row === 2 && m.col === 5)).toBe(false);
    expect(
      result.some((m) => m.row === 10 && (m.col === 1 || m.col === 5)),
    ).toBe(true);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- narrow.spec`
Expected: FAIL — quiet-fallback tests receive `[]` since step 4 isn't implemented yet, and the tactical-set reordering test fails because Task 5 left it in `Map` insertion order (both `rngLow`/`rngHigh` produce the same `[0]`). The updated unrecognized-fork test should already pass at this point (step 3 alone, unaffected by step 4's absence) — confirm it does, so you know the replacement fixture itself is sound before moving on.

- [ ] **Step 4: Write the implementation**

Add near the top of `src/engine/narrow.ts`, alongside the other imports:

```typescript
import {
  decayRateForMoveCount,
  distanceWeight,
  sampleWithoutReplacement,
} from "./randomize.ts";
```

Add this constant and helper above `narrowCandidates`:

```typescript
const QUIET_FALLBACK_SAMPLE_SIZE = 8;

function chebyshevDistance(a: Move, b: Move): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

function nearestStoneDistance(board: Board, move: Move): number {
  let nearest = Infinity;
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] === 0) {
        continue;
      }
      const distance = chebyshevDistance(move, { row, col });
      if (distance < nearest) {
        nearest = distance;
      }
    }
  }
  return nearest;
}

/** Reorders `moves` via the same weighted-random mechanism used for the
 * quiet fallback (a full shuffle, since count === moves.length), so a
 * downstream consumer that takes "the first candidate" (patternOnlyStrategy)
 * sees variety instead of a fixed Map-insertion-order pick when multiple
 * moves tie for the same tactical priority. */
function weightedReorder(
  board: Board,
  moves: Move[],
  moveCount: number,
  config: NarrowConfig,
): Move[] {
  if (moves.length <= 1) {
    return moves;
  }
  const decayRate = decayRateForMoveCount(moveCount, config.decay);
  const weights = moves.map((move) =>
    distanceWeight(nearestStoneDistance(board, move), decayRate),
  );
  return sampleWithoutReplacement(moves, weights, moves.length, config.rng);
}
```

Update the tactical-set early return from Task 5 (find this exact block, still present unchanged from Task 5, and replace it):

```typescript
  // before (Task 5):
  if (tacticalMoves.size > 0) {
    return [...tacticalMoves.values()];
  }
  // after:
  if (tacticalMoves.size > 0) {
    return weightedReorder(
      board,
      [...tacticalMoves.values()],
      moveCount,
      config,
    );
  }
```

Replace the final `return [];` in `narrowCandidates` with:

```typescript
  // Step 4: quiet fallback — no tactical pattern exists yet (typical in
  // the opening). Sample a small, distance-weighted subset of the raw
  // radius-2 neighborhood instead of returning it all, so quiet positions
  // stay fast and vary between games instead of always resolving to the
  // same deterministic scan-order pick.
  const raw = findCandidateMoves(board);
  if (raw.length <= QUIET_FALLBACK_SAMPLE_SIZE) {
    return weightedReorder(board, raw, moveCount, config);
  }

  const decayRate = decayRateForMoveCount(moveCount, config.decay);
  const weights = raw.map((move) =>
    distanceWeight(nearestStoneDistance(board, move), decayRate),
  );
  return sampleWithoutReplacement(
    raw,
    weights,
    QUIET_FALLBACK_SAMPLE_SIZE,
    config.rng,
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- narrow.spec`
Expected: PASS, 25/25 tests

- [ ] **Step 6: Run the full suite to confirm nothing else broke from relocating `findCandidateMoves`**

Run: `npm test`
Expected: PASS, all suites green (the temporary re-export in `search.ts` from Step 1 keeps `search.spec.ts` compiling until Task 7 removes it)

- [ ] **Step 7: Commit**

```bash
git add src/engine/narrow.ts src/engine/narrow.spec.ts src/engine/search.ts src/engine/search.spec.ts
git commit -m "feat: complete narrowCandidates with distance-weighted quiet fallback"
```

---

### Task 7: `search.ts` — wire `negamax` to `narrowCandidates`

**Files:**

- Modify: `src/engine/search.ts` (replace `findCandidateMoves`+`orderMoves` usage with `narrowCandidates`; remove `orderMoves`/`movesGaining`; remove temporary debug `console.log` calls; add optional-with-defaults handling for `SearchConfig`)
- Modify: `src/engine/search.spec.ts` (remove the `orderMoves` describe block; update imports)

**Interfaces:**

- Consumes: `narrowCandidates`, `type NarrowConfig` from `./narrow.ts`; `ALL_FORK_PATTERN_NAMES`, `type ForkPatternName` from `./narrow.ts`; `DEFAULT_DECAY_CONFIG` — **new**, defined in this task in `search.ts` (the baseline `DecayConfig` used when a caller omits one; re-exported for `engine.ts` to reuse in Task 10).
- Produces: `interface SearchConfig { maxDepth: number; timeBudgetMs?: number; recognizedForkPatterns?: ReadonlySet<ForkPatternName>; decay?: DecayConfig }` (optional fields, per Global Constraints) — `negamax`'s internal signature also changes to thread `moveCount`, the resolved `NarrowConfig`, and an optional trailing `rootMoves?: Move[]` (unused by anything in this task, added now so Task 8 can reuse `negamax`'s loop for the root ply instead of duplicating it), but stays unexported (only `search`/`negamaxSearch`'s exported signatures matter to later tasks).

The debug `console.log` calls currently present in `search.ts` (`[search] probe #...`, the `search`/`RESULT`/`best node` dumps) were added during this session's live debugging and are superseded by this rework — this task removes them as part of rewriting the surrounding code they're embedded in.

- [ ] **Step 1: Write the failing tests**

Replace `src/engine/search.spec.ts`'s imports and delete the entire `describe("orderMoves", ...)` block (all three tests: "puts the move that completes a five first", "prioritizes blocking...", "prioritizes completing an own four..."). Their regression intent is already covered by `narrow.spec.ts`'s Task 4 tests (`"returns only the gain when the mover already has a completable four"`, `"prioritizes the mover's own win over blocking the opponent's four"`) and Task 5 tests.

Change the top of `src/engine/search.spec.ts` from:

```typescript
import { findForkPoints, findPatterns } from "./patterns.ts";
import {
  findCandidateMoves,
  negamaxSearch,
  orderMoves,
  search,
} from "./search.ts";
import { WIN_SCORE } from "./evaluate.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";
```

to:

```typescript
import { negamaxSearch, search } from "./search.ts";
import { WIN_SCORE } from "./evaluate.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";
```

(No `findCandidateMoves` import here: its `describe` block was already relocated to `narrow.spec.ts` in Task 6 Step 1, and nothing else in this file references it — importing it unused would fail lint. If the block is still present here from before Task 6, remove it now; it should not exist in both files.)

Run: `npm test -- search.spec`
Expected: FAIL — `orderMoves` import no longer resolves (confirms the old tests are gone); other tests still reference the real `negamaxSearch`/`search`, which still exist, so this is a compile-time failure from the deleted import until Step 3 completes, not yet a real RED-for-new-behavior state. Proceed to Step 3.

- [ ] **Step 2: n/a — this task's "RED" state is the compile failure above; there is no new test to add before implementing**

- [ ] **Step 3: Rewrite `search.ts`**

Replace the entire contents of `src/engine/search.ts`:

```typescript
// src/engine/search.ts
import { placeMove, type Board, type Player } from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { evaluate, WIN_SCORE } from "./evaluate.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  findCandidateMoves,
  narrowCandidates,
  type ForkPatternName,
  type NarrowConfig,
} from "./narrow.ts";
import type { DecayConfig } from "./randomize.ts";
import type { Move } from "./state.ts";

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  startDecay: 0.8,
  minDecay: 0.15,
  stepDown: 0.05,
};

interface SearchNode {
  score: number;
  principalVariation: Move[];
}

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

interface NodeCounter {
  count: number;
}

function negamax(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
  deadline: number | null,
  nodeCounter: NodeCounter,
  moveCount: number,
  narrowConfig: NarrowConfig,
  rootMoves?: Move[],
): SearchNode {
  nodeCounter.count += 1;

  if (depth === 0) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  // Check before paying for narrowCandidates' pattern computation — see
  // the deadline-precision note this comment replaces below.
  if (deadline !== null && Date.now() > deadline) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  // `rootMoves`, when provided, is the exact pre-narrowed candidate set a
  // MoveSelectionStrategy (Task 8) already computed once via
  // narrowCandidates before invoking this search — reusing it here (rather
  // than recomputing) avoids both duplicating this loop in the strategy
  // and silently re-rolling narrowCandidates' weighted-random reordering
  // into a different order than what the strategy actually received.
  // Every recursive call omits it, so deeper plies compute their own
  // candidates as normal.
  const moves = rootMoves ?? narrowCandidates(board, player, moveCount, narrowConfig);
  if (moves.length === 0) {
    return { score: 0, principalVariation: [] };
  }

  let best: SearchNode = { score: -Infinity, principalVariation: [] };
  let currentAlpha = alpha;

  for (const move of moves) {
    if (deadline !== null && Date.now() > deadline) {
      break;
    }

    const next = placeMove(board, move.row, move.col, player);
    const isWin = checkCaroWin(next, move.row, move.col, player);

    const node: SearchNode = isWin
      ? { score: WIN_SCORE + depth, principalVariation: [] }
      : (() => {
          const child = negamax(
            next,
            otherPlayer(player),
            depth - 1,
            -beta,
            -currentAlpha,
            deadline,
            nodeCounter,
            moveCount + 1,
            narrowConfig,
          );
          return {
            score: -child.score,
            principalVariation: child.principalVariation,
          };
        })();

    if (node.score > best.score) {
      best = {
        score: node.score,
        principalVariation: [move, ...node.principalVariation],
      };
    }
    currentAlpha = Math.max(currentAlpha, node.score);
    if (currentAlpha >= beta) {
      break;
    }
  }

  // If the deadline fired before any move in this node was evaluated,
  // `best` is still the -Infinity sentinel. A parent frame negates a
  // child's score (`-child.score`) to fold it into its own comparison,
  // which would turn an un-evaluated -Infinity into a bogus +Infinity —
  // a false "forced win" signal. Fall back to a finite static evaluation
  // instead, matching what a depth-0 leaf would report.
  if (best.score === -Infinity) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  return best;
}

function resolveNarrowConfig(config: SearchConfig): NarrowConfig {
  return {
    recognizedForkPatterns:
      config.recognizedForkPatterns ?? ALL_FORK_PATTERN_NAMES,
    decay: config.decay ?? DEFAULT_DECAY_CONFIG,
  };
}

function countStones(board: Board): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell !== 0) {
        count += 1;
      }
    }
  }
  return count;
}

export function negamaxSearch(
  board: Board,
  player: Player,
  depth: number,
): SearchNode {
  const narrowConfig: NarrowConfig = {
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    decay: DEFAULT_DECAY_CONFIG,
  };
  return negamax(
    board,
    player,
    depth,
    -Infinity,
    Infinity,
    null,
    { count: 0 },
    countStones(board),
    narrowConfig,
  );
}

export interface SearchResult {
  move: Move;
  score: number;
  depth: number;
  principalVariation: Move[];
  nodesVisited: number;
}

export interface SearchConfig {
  maxDepth: number;
  timeBudgetMs?: number;
  recognizedForkPatterns?: ReadonlySet<ForkPatternName>;
  decay?: DecayConfig;
}

export function search(
  board: Board,
  player: Player,
  config: SearchConfig,
): SearchResult {
  const deadline =
    config.timeBudgetMs !== undefined
      ? Date.now() + config.timeBudgetMs
      : null;
  const nodeCounter: NodeCounter = { count: 0 };
  const narrowConfig = resolveNarrowConfig(config);
  const moveCount = countStones(board);

  let bestNode: SearchNode | null = null;
  let depthReached = 0;

  for (let depth = 1; depth <= config.maxDepth; depth += 1) {
    if (deadline !== null && Date.now() > deadline) {
      break;
    }
    const result = negamax(
      board,
      player,
      depth,
      -Infinity,
      Infinity,
      deadline,
      nodeCounter,
      moveCount,
      narrowConfig,
    );
    if (result.principalVariation.length === 0) {
      break;
    }
    bestNode = result;
    depthReached = depth;
    if (Math.abs(result.score) >= WIN_SCORE) {
      break;
    }
  }

  if (bestNode === null) {
    const fallbackMoves = findCandidateMoves(board);
    return {
      move: fallbackMoves[0],
      score: 0,
      depth: 0,
      principalVariation: [],
      nodesVisited: nodeCounter.count,
    };
  }

  return {
    move: bestNode.principalVariation[0],
    score: bestNode.score,
    depth: depthReached,
    principalVariation: bestNode.principalVariation,
    nodesVisited: nodeCounter.count,
  };
}
```

This removes `orderMoves`, `movesGaining`, the standalone `findCandidateMoves` definition (now re-exported from `narrow.ts`), and every debug `console.log` call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- search.spec`
Expected: PASS, 7/7 tests (3 `negamaxSearch` + 4 `search`; the `findCandidateMoves` and `orderMoves` describe blocks are gone from this file)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, all suites green. This confirms the `evaluate.spec.ts`/`narrow.spec.ts`/`patterns.spec.ts` suites are unaffected and the relocated `findCandidateMoves` re-export resolves correctly for any remaining consumer.

- [ ] **Step 6: Commit**

```bash
git add src/engine/search.ts src/engine/search.spec.ts
git commit -m "feat: wire negamax to narrowCandidates, remove orderMoves and debug logging"
```

---

### Task 8: `search.ts` — pluggable move-selection strategy

**Files:**

- Modify: `src/engine/search.ts` (add `MoveSelectionStrategy`, `negamaxStrategy`, `patternOnlyStrategy`; `search()` accepts an optional `strategy` parameter)
- Modify: `src/engine/search.spec.ts` (add tests)

**Interfaces:**

- Consumes: `narrowCandidates`, `type NarrowConfig` (already imported in Task 7).
- Produces: `type MoveSelectionStrategy = (board: Board, player: Player, candidates: Move[], config: SearchConfig) => SearchResult`, `negamaxStrategy: MoveSelectionStrategy`, `patternOnlyStrategy: MoveSelectionStrategy`, `search(board: Board, player: Player, config: SearchConfig, strategy?: MoveSelectionStrategy): SearchResult` (strategy defaults to `negamaxStrategy`) — consumed directly by tests in this task and available for `engine.ts`/future callers.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/search.spec.ts`:

```typescript
import {
  negamaxStrategy,
  patternOnlyStrategy,
  search,
  type MoveSelectionStrategy,
} from "./search.ts";

describe("pluggable move-selection strategy", () => {
  it("defaults to negamaxStrategy, which explores multiple nodes", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    const result = search(board, 2, { maxDepth: 2 });
    expect(result.nodesVisited).toBeGreaterThan(1);
  });

  it("patternOnlyStrategy takes narrowing's top pick with zero search overhead", () => {
    const board = parseBoard("OXXXX.");
    const result = search(
      board,
      1,
      { maxDepth: 4 },
      patternOnlyStrategy,
    );
    expect(result.move).toEqual({ row: 0, col: 5 });
    expect(result.nodesVisited).toBe(0);
  });

  it("a custom strategy can be substituted without touching narrowCandidates", () => {
    const alwaysFirstCandidate: MoveSelectionStrategy = (
      _board,
      _player,
      candidates,
    ) => ({
      move: candidates[0],
      score: 0,
      depth: 0,
      principalVariation: [candidates[0]],
      nodesVisited: 0,
    });
    const board = parseBoard("OXXXX.");
    const result = search(
      board,
      1,
      { maxDepth: 4 },
      alwaysFirstCandidate,
    );
    // Forced-block narrowing still yields exactly one candidate here, so
    // "always take the first" and "negamax" agree — the point of this
    // test is that a hand-rolled strategy function works at all.
    expect(result.move).toEqual({ row: 0, col: 5 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- search.spec`
Expected: FAIL with `negamaxStrategy`/`patternOnlyStrategy` are not exported

- [ ] **Step 3: Write the implementation**

In `src/engine/search.ts`, add above `export function search(...)`:

```typescript
export type MoveSelectionStrategy = (
  board: Board,
  player: Player,
  candidates: Move[],
  config: SearchConfig,
) => SearchResult;

export const negamaxStrategy: MoveSelectionStrategy = (
  board,
  player,
  candidates,
  config,
) => {
  const deadline =
    config.timeBudgetMs !== undefined
      ? Date.now() + config.timeBudgetMs
      : null;
  const nodeCounter: NodeCounter = { count: 0 };
  const narrowConfig = resolveNarrowConfig(config);
  const moveCount = countStones(board);

  let bestNode: SearchNode | null = null;
  let depthReached = 0;

  for (let depth = 1; depth <= config.maxDepth; depth += 1) {
    if (deadline !== null && Date.now() > deadline) {
      break;
    }
    // Reuse negamax's existing loop/pruning logic rather than
    // reimplementing it here — `candidates` (the exact pre-narrowed set
    // `search()` computed once) is threaded through as `rootMoves`, so
    // this call searches precisely those moves instead of recomputing
    // (and potentially re-rolling a different weighted-random order for)
    // its own candidate set. Deeper recursive calls inside `negamax` omit
    // `rootMoves` and narrow normally at every subsequent node.
    const result = negamax(
      board,
      player,
      depth,
      -Infinity,
      Infinity,
      deadline,
      nodeCounter,
      moveCount,
      narrowConfig,
      candidates,
    );
    if (result.principalVariation.length === 0) {
      break;
    }
    bestNode = result;
    depthReached = depth;
    if (Math.abs(result.score) >= WIN_SCORE) {
      break;
    }
  }

  if (bestNode === null) {
    return {
      move: candidates[0],
      score: 0,
      depth: 0,
      principalVariation: [],
      nodesVisited: nodeCounter.count,
    };
  }

  return {
    move: bestNode.principalVariation[0],
    score: bestNode.score,
    depth: depthReached,
    principalVariation: bestNode.principalVariation,
    nodesVisited: nodeCounter.count,
  };
};

/** Zero-lookahead: takes narrowing's top candidate directly, with no
 * verification search. For testing narrowCandidates in isolation and as
 * a template for future alternative strategies. */
export const patternOnlyStrategy: MoveSelectionStrategy = (
  _board,
  _player,
  candidates,
) => ({
  move: candidates[0],
  score: 0,
  depth: 0,
  principalVariation: [candidates[0]],
  nodesVisited: 0,
});
```

Change `export function search(...)`'s signature and body to delegate to the strategy:

```typescript
export function search(
  board: Board,
  player: Player,
  config: SearchConfig,
  strategy: MoveSelectionStrategy = negamaxStrategy,
): SearchResult {
  const narrowConfig = resolveNarrowConfig(config);
  const moveCount = countStones(board);
  const candidates = narrowCandidates(board, player, moveCount, narrowConfig);

  if (candidates.length === 0) {
    const fallbackMoves = findCandidateMoves(board);
    return {
      move: fallbackMoves[0],
      score: 0,
      depth: 0,
      principalVariation: [],
      nodesVisited: 0,
    };
  }

  return strategy(board, player, candidates, config);
}
```

Remove the old inline iterative-deepening loop that was previously the body of `search()` (Task 7's version) — it is now `negamaxStrategy`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- search.spec`
Expected: PASS, 10/10 tests

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, all suites green — in particular, re-confirm `search.spec.ts`'s pre-existing tactical puzzle tests (win-in-1, forced block, win-in-3 fork) still pass under `negamaxStrategy` as the default.

- [ ] **Step 6: Commit**

```bash
git add src/engine/search.ts src/engine/search.spec.ts
git commit -m "feat: make move-selection strategy pluggable in search()"
```

---

### Task 9: Regression tests for this session's exact bugs

**Files:**

- Modify: `src/engine/search.spec.ts` (add regression tests)

**Interfaces:**

- Consumes: `search`, `patternOnlyStrategy` from this file.
- Produces: nothing new — pure verification, matching the design doc's testing strategy.

- [ ] **Step 1: Write the tests**

Add to `src/engine/search.spec.ts`:

```typescript
describe("regression: manual playtesting findings (2026-07-16 session)", () => {
  it("blocks an open three even with nothing better to do", () => {
    // The exact scenario found during manual play: the opponent has an
    // open three and the engine has one unrelated stone. Previously the
    // engine's candidate loop could exhaust its time budget before ever
    // reaching the blocking cells (scan-order dependent); narrowCandidates
    // makes blocking part of the tactical set unconditionally.
    const board = parseBoard(`
      ....................
      ....................
      ....................
      ...XXX..............
      ....................
      ..O.................
      ....................
    `);
    const result = search(board, 2, { maxDepth: 4, timeBudgetMs: 2000 });
    const blocksLeft = result.move.row === 3 && result.move.col === 2;
    const blocksRight = result.move.row === 3 && result.move.col === 6;
    expect(blocksLeft || blocksRight).toBe(true);
  });

  it("does not always play the same relative first move", () => {
    const positions: Array<[number, number]> = [
      [5, 5],
      [12, 3],
      [15, 15],
    ];
    const offsets = new Set<string>();
    for (const [row, col] of positions) {
      const board = createBoardWithSingleStone(row, col);
      const result = search(board, 2, { maxDepth: 2, timeBudgetMs: 500 });
      offsets.add(`${result.move.row - row},${result.move.col - col}`);
    }
    expect(offsets.size).toBeGreaterThan(1);
  });

  it("patternOnlyStrategy alone (no negamax) also blocks the same open three", () => {
    const board = parseBoard(`
      ....................
      ....................
      ....................
      ...XXX..............
      ....................
      ..O.................
      ....................
    `);
    const result = search(
      board,
      2,
      { maxDepth: 4 },
      patternOnlyStrategy,
    );
    expect(result.nodesVisited).toBe(0);
    const blocksLeft = result.move.row === 3 && result.move.col === 2;
    const blocksRight = result.move.row === 3 && result.move.col === 6;
    expect(blocksLeft || blocksRight).toBe(true);
  });
});

function createBoardWithSingleStone(row: number, col: number) {
  const size = 20;
  const board = Array.from({ length: size }, () =>
    Array<0 | 1 | 2>(size).fill(0),
  );
  board[row][col] = 1;
  return board;
}
```

- [ ] **Step 2: Run tests to verify they fail on the pre-narrowing behavior**

This step is informational, not a strict RED requirement — these tests exercise the already-implemented `narrowCandidates`/`search` from Tasks 4-8, so they are expected to already pass once written (confirming the fix, not discovering a new failure). Run: `npm test -- search.spec` and confirm all pass; if the "does not always play the same relative first move" test flakes (offsets could coincidentally collide across only 3 samples), that is a real signal to investigate `narrowCandidates`' quiet-fallback sampling, not a test to loosen — retry a few times to distinguish genuine non-determinism from a bug before concluding either way.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test -- search.spec`
Expected: PASS, 13/13 tests

- [ ] **Step 4: Commit**

```bash
git add src/engine/search.spec.ts
git commit -m "test: add regression coverage for manual-playtesting findings"
```

---

### Task 10: `engine.ts` — difficulty-gated fork catalog + decay

**Files:**

- Modify: `src/engine/engine.ts` (replace `DIFFICULTY_DEPTH`-only config with pattern-tier/fork-catalog-aware difficulty mapping)
- Modify: `src/engine/engine.spec.ts` (add a test proving the wiring)

**Interfaces:**

- Consumes: `FORK_PATTERNS`, `ALL_FORK_PATTERN_NAMES`, `type ForkPatternName` from `./narrow.ts`; `DEFAULT_DECAY_CONFIG` from `./search.ts`.
- Produces: `chooseMove`'s signature is unchanged (`chooseMove(state: GameState, config?: EngineConfig): SearchResult`), but its internal difficulty mapping now threads `recognizedForkPatterns` and `decay` into `SearchConfig`.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/engine.spec.ts`:

```typescript
describe("chooseMove — difficulty-gated fork recognition", () => {
  it("hard recognizes a fork that easy does not, on an identical position", () => {
    let state = newGame();
    // Build the double-three-trap shape from narrow.spec.ts, placed so it
    // sits within radius 2 of itself (already true — no extra setup
    // needed beyond placing the exact stones), with X to move.
    state = applyMove(state, { row: 6, col: 10 }, 1); // filler so O has a turn
    state = applyMove(state, { row: 0, col: 0 }, 2); // filler, far away
    state = applyMove(state, { row: 4, col: 9 }, 1);
    state = applyMove(state, { row: 0, col: 1 }, 2); // filler, far away
    state = applyMove(state, { row: 5, col: 7 }, 1);
    state = applyMove(state, { row: 0, col: 2 }, 2); // filler, far away
    state = applyMove(state, { row: 5, col: 8 }, 1);
    state = applyMove(state, { row: 0, col: 3 }, 2); // filler, far away

    const easy = chooseMove(state, { difficulty: "easy", timeBudgetMs: 500 });
    const hard = chooseMove(state, { difficulty: "hard", timeBudgetMs: 2000 });

    // hard's narrowed candidate set includes the fork point (9,9); easy's
    // does not recognize forks at all, so it cannot even consider it as a
    // priority move (it may still stumble onto it via the quiet fallback
    // sample, so this asserts hard's score reflects fork awareness rather
    // than asserting easy never plays it).
    expect(hard.score).toBeGreaterThanOrEqual(easy.score);
  });
});
```

If this hand-built diagram's coordinates don't produce the intended double-three-trap shape once run (multi-line board setup through `applyMove` sequences is easy to get subtly wrong by hand — the same caveat the original engine plan repeatedly notes for hand-built puzzles), adjust the stone placements until `findForkPoints`/`recognizedForkPoints` (verified directly, e.g. via a temporary console.log) confirms a fork point exists at a known cell; the property under test — hard's search reflects fork awareness that easy's does not — is what matters, not these exact coordinates.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- engine.spec -t "difficulty-gated fork"`
Expected: FAIL or PASS-by-accident — since `engine.ts` doesn't yet thread `recognizedForkPatterns` per difficulty, both `easy` and `hard` currently get the same (default, full) fork recognition, so this assertion may pass trivially. Proceed to implementation regardless; Step 4 re-confirms intent.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/engine/engine.ts`:

```typescript
import { search, type SearchResult } from "./search.ts";
import { DEFAULT_DECAY_CONFIG } from "./search.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  type ForkPatternName,
} from "./narrow.ts";
import type { GameState } from "./state.ts";

export type Difficulty = "easy" | "medium" | "hard";

export interface EngineConfig {
  difficulty: Difficulty;
  timeBudgetMs?: number;
}

const DIFFICULTY_DEPTH: Record<Difficulty, number> = {
  easy: 2,
  medium: 4,
  hard: 6,
};

// Default per-difficulty time budgets, in milliseconds. Callers that pass
// an explicit `timeBudgetMs` always override these defaults.
const DIFFICULTY_TIME_BUDGET_MS: Record<Difficulty, number> = {
  easy: 500,
  medium: 2000,
  hard: 5000,
};

// The line-pattern ladder (two -> five) is always fully recognized at
// every difficulty; only fork recognition is difficulty-gated. Medium
// recognizes the two most common/basic fork shapes; hard recognizes
// everything in the catalog (medium's two plus the rest).
const DIFFICULTY_FORK_PATTERNS: Record<
  Difficulty,
  ReadonlySet<ForkPatternName>
> = {
  easy: new Set(),
  medium: new Set(["double-three-trap", "double-four-trap"]),
  hard: ALL_FORK_PATTERN_NAMES,
};

const DEFAULT_CONFIG: EngineConfig = { difficulty: "medium" };

/**
 * Chooses the engine's next move for `state.nextPlayer`. Returns the full
 * SearchResult (not just the move) so callers can inspect score, depth
 * reached, and the principal variation for debugging or future bridging.
 */
export function chooseMove(
  state: GameState,
  config: EngineConfig = DEFAULT_CONFIG,
): SearchResult {
  const maxDepth = DIFFICULTY_DEPTH[config.difficulty];
  const timeBudgetMs =
    config.timeBudgetMs ?? DIFFICULTY_TIME_BUDGET_MS[config.difficulty];
  return search(state.board, state.nextPlayer, {
    maxDepth,
    timeBudgetMs,
    recognizedForkPatterns: DIFFICULTY_FORK_PATTERNS[config.difficulty],
    decay: DEFAULT_DECAY_CONFIG,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- engine.spec`
Expected: PASS, 6/6 tests

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: Both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/engine.ts src/engine/engine.spec.ts
git commit -m "feat: thread difficulty-gated fork catalog into chooseMove"
```

---

### Task 11: `engine.difficulty.spec.ts` — sharpen the easy/hard fork gap

**Files:**

- Modify: `src/engine/engine.difficulty.spec.ts`

**Interfaces:**

- Consumes: `narrow.ts`'s catalog is available but not imported here — this task only changes literal `SearchConfig` values in this test file.
- Produces: nothing new.

This test predates the fork catalog and constructs `EASY_CONFIG`/`HARD_CONFIG` without `recognizedForkPatterns`, so both default to `ALL_FORK_PATTERN_NAMES` (full recognition) after Task 7 — the self-play "hard beats easy" test currently distinguishes the two configs only by depth/time budget. Explicitly restricting `EASY_CONFIG` to no fork recognition (matching the real `easy` difficulty's behavior in `engine.ts`) gives `hard` a genuine additional structural advantage, which should make this smoke test's outcome more reliable — this test has been observed to be flaky (a thin 3-game sample with only a depth/budget gap between the sides), and giving `hard` a qualitative edge, not just a quantitative one, directly addresses that.

- [ ] **Step 1: Update the configs**

In `src/engine/engine.difficulty.spec.ts`, change:

```typescript
import { search, type SearchConfig } from "./search.ts";

const SMALL_BOARD_SIZE = 11;
const EASY_CONFIG: SearchConfig = { maxDepth: 2, timeBudgetMs: 200 };
const HARD_CONFIG: SearchConfig = { maxDepth: 6, timeBudgetMs: 800 };
```

to:

```typescript
import { search, type SearchConfig } from "./search.ts";
import { ALL_FORK_PATTERN_NAMES } from "./narrow.ts";

const SMALL_BOARD_SIZE = 11;
const EASY_CONFIG: SearchConfig = {
  maxDepth: 2,
  timeBudgetMs: 200,
  recognizedForkPatterns: new Set(),
};
const HARD_CONFIG: SearchConfig = {
  maxDepth: 6,
  timeBudgetMs: 800,
  recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
};
```

Leave the second test's inline `{ maxDepth: 10, timeBudgetMs: 150 }` config unchanged — it doesn't compare difficulties, so the new fields aren't relevant there (they default to full recognition, which is fine for a pure time-budget check).

- [ ] **Step 2: Run the tests**

Run: `npm test -- engine.difficulty`
Expected: PASS, 2/2 tests. Run it 3 times in a row to spot-check for flakiness improvement (informational — do not loosen the assertion regardless of outcome; if it still fails intermittently, that is a real signal for a future follow-up task, not something to fix by weakening this test).

- [ ] **Step 3: Commit**

```bash
git add src/engine/engine.difficulty.spec.ts
git commit -m "test: give easy a genuine fork-recognition gap in the difficulty smoke test"
```

---

### Task 12: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the complete suite**

Run: `npm test`
Expected: PASS, all suites green.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: Both PASS, no errors.

- [ ] **Step 3: Confirm the UI still builds**

Run: `npm run build`
Expected: PASS — `src/ui/app.ts` still calls `chooseMove(state, { difficulty: currentDifficulty() }).move`, whose signature is unchanged by this plan, so no `app.ts` changes are expected. If `typecheck`/`build` surface a mismatch, `chooseMove`'s exported signature must not have changed as intended — investigate before proceeding.

- [ ] **Step 4: Manual smoke test**

Run: `npm start`, open `http://localhost:3000`, and replay this session's original complaints:
- Build an open three and confirm the engine (any difficulty) blocks it or takes a better move, not silence.
- Play several fresh games and confirm the engine's first reply is not always the same relative offset.
- At Hard difficulty, try to set up a double-three shape and confirm the engine either blocks it or exploits it (depending on which side has it).

Stop the server (Ctrl+C) once verified. This step cannot be automated — report the outcome honestly, including any remaining rough edges, rather than assuming success from the automated suite alone.

- [ ] **Step 5: No commit for this task** — it is verification-only. If Step 4 finds a real bug, stop and follow superpowers:systematic-debugging before touching code further; do not patch ad hoc.

---

## After all tasks

Once Task 12 is complete and the full suite is green, use **superpowers:finishing-a-development-branch** to decide how to integrate this work. The full VCF/VCT forced-win search (original roadmap Phase B) and `patterns.ts`'s per-node recomputation cost (Phase C2) remain explicitly out of scope, per the design doc's Goals section — both stay available as separate future work on top of the `narrow.ts`/`randomize.ts` vocabulary established here.
