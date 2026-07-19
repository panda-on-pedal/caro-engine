# Threat-Space Search (TSS) + Expert Difficulty — Design

Date: 2026-07-19
Status: approved design, pre-implementation
Methodology: TDD throughout
Extends: `2026-07-16-gomoku-engine-design.md` (Phase B),
`2026-07-17-pattern-driven-search-design.md`

## Background

Phase A + pattern-driven narrowing + incremental `PatternStore` are in place.
`narrowCandidates` already short-circuits immediate four / open-four win and
block, and feeds a small tactical set into negamax. That is **not** TSS: it
only chooses candidates at each ply inside a fixed-depth mixed search.

Long forcing sequences (open-three → block → fork → four → …) often need more
plies than `hard` (depth 6) can see. Threat-space search proves those lines by
exploring only forcing moves and forced replies.

**Threat set choice (locked): option A** — fours / open-fours, open-three
critical gains, and recognized fork points. Plain `three` / `open-two` gains
are out of v1 (wider tree; revisit later if needed).

## Goals

1. Add a dedicated prover `findForcedWin(...)` that searches only forcing
   sequences using option-A threats.
2. Gate it behind a new difficulty **`expert`** (TSS off for easy / medium /
   hard so their behavior stays unchanged).
3. On `expert`, run TSS **before** negamax; if a forced win (or must-block
   against the opponent’s forced win) is found, play that line; otherwise
   fall back to today’s search.
4. Reuse `PatternStore` place/undo; no full-board rescans in the prover.
5. Leave a clean API for later LLM briefings (`forced-win` status + PV).

## Non-goals (this pass)

- Transposition table / Zobrist / killers (Phase C1).
- Typed-array board, opening book, score-table retune (Phase C3).
- `analysis.ts` / `report.ts` LLM bridge UI (API shape only).
- Replacing negamax for quiet / positional play.
- Expanding the attacker threat set to plain `three` / `open-two` (option B).

## Difficulty and config

**Single source of truth:** replace today’s separate `DIFFICULTY_DEPTH` /
`DIFFICULTY_TIME_BUDGET_MS` / `DIFFICULTY_FORK_PATTERNS` /
`DIFFICULTY_ROOT_JITTER` maps with one `DIFFICULTY_PROFILES` table. Tuning
a level later means editing one object per difficulty.

```ts
type Difficulty = "easy" | "medium" | "hard" | "expert";

interface DifficultyProfile {
  maxDepth: number;
  timeBudgetMs: number;
  recognizedForkPatterns: ReadonlySet<ForkPatternName>;
  rootScoreJitter: number;
  threatSearch: boolean;
  /** Max plies for TSS (attacker+defender). Ignored when threatSearch is false. */
  threatMaxPly: number;
}

const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy:   { maxDepth: 2, timeBudgetMs: 500,  recognizedForkPatterns: empty,
            rootScoreJitter: 0.15, threatSearch: false, threatMaxPly: 0 },
  medium: { maxDepth: 4, timeBudgetMs: 2000, recognizedForkPatterns: mediumForks,
            rootScoreJitter: 0.1,  threatSearch: false, threatMaxPly: 0 },
  hard:   { maxDepth: 6, timeBudgetMs: 5000, recognizedForkPatterns: allForks,
            rootScoreJitter: 0.05, threatSearch: false, threatMaxPly: 0 },
  expert: { maxDepth: 6, timeBudgetMs: 10000, recognizedForkPatterns: allForks,
            rootScoreJitter: 0.02, threatSearch: true,  threatMaxPly: 16 },
};

interface EngineConfig {
  difficulty: Difficulty;
  /** Optional overrides — each falls back to the profile when omitted. */
  timeBudgetMs?: number;
  rootScoreJitter?: number;
  threatSearch?: boolean;
}
```

`chooseMove` resolves `profile = DIFFICULTY_PROFILES[difficulty]`, then
applies any per-call overrides, and passes a flat `SearchConfig` into
`search`. No other module hard-codes per-difficulty numbers.

`expert` strength gain comes from TSS (`threatSearch: true`), not from a
deeper negamax than hard.

UI: add an **Expert** option to `#difficulty`, `#difficulty-p1`, and
`#difficulty-p2` in `index.html`.

## Architecture

```
src/engine/
  threatSearch.ts   NEW  findForcedWin + threat/defence move helpers
  search.ts         wire: if threatSearch → TSS first, else/fallback negamax
  engine.ts         expert difficulty + threatSearch flag
  patterns.ts       unchanged (PatternInstance / findForkPoints)
  patternStore.ts   unchanged (place/undo substrate)
  narrow.ts         unchanged (still used by negamax fallback)
```

Dependency: `engine → search → threatSearch → patternStore / patterns / rules`.

## Threat vocabulary (option A)

All derived from existing `PatternInstance` data + `findForkPoints`.

### Attacker threat moves

Union of empty cells (deduped) that are:

1. **Four / open-four gains** — any `gains` of own `four` or `open-four`.
2. **Open-three critical gains** — `criticalGains` of own `open-three` only
   (not plain `three`, not `open-two`).
3. **Fork points** — `findForkPoints(ownPatterns)` move cells, restricted to
   forks whose contributing patterns are at least as severe as open-three /
   four tiers used by the hard fork catalog (same recognition set as
   `expert` / `hard`: `ALL_FORK_PATTERN_NAMES`). A fork point already in (1)
   or (2) is kept once.

Ordering for the prover (try first): four/open-four gains → fork points →
open-three critical gains. Within a bucket, stable by `(row, col)` for
deterministic tests.

### When is a just-played attack move a “threat”?

After the attacker places a candidate:

1. If `checkCaroWin` → terminal success (no defender reply).
2. Else if the defender has an **immediate win** (`hasImmediateWin`) → the
   branch fails. The defender will take their win instead of answering;
   an open-four (or any threat) is not forcing against a pending four.
3. Else compute the **defence set** for the opponent (below). If that set is
   non-empty, the move is forcing and the prover enters an AND node over
   those replies.
4. Else if the attacker has an unstoppable four/open-four (empty surviving
   defence) → success. Otherwise reject the branch (not forcing; do not
   recurse into quiet play).

This keeps the definition operational: a move is a threat iff the defender
must answer and cannot win on the spot instead.

### Defender reply moves

Build the defence set from the attacker’s patterns **after** the attack move
(using `PatternStore` caches):

1. **Four / open-four present for attacker** → union of those patterns’
   `gains`, plus `boxCell` when `narrow` would add it. If futility filtering
   (same idea as `survivingBlocks`) leaves zero surviving blocks against an
   open-four, the force has already succeeded — no AND node.
2. **Else, recognized fork point(s) for attacker** → union of `gains` of all
   patterns that participate in those fork points (the cells defender might
   play to break at least one arm). AND over each distinct reply cell.
3. **Else, attacker open-three with non-empty `criticalGains`** → union of
   those `criticalGains`.
4. **Else** → empty (not a TSS threat).

Priority is exclusive top-down (1 then 2 then 3): if a four already exists,
defence is only about that four; do not widen to every open-three on the
board.

## Algorithm

```ts
type ForcedWinResult = {
  won: boolean;
  principalVariation: Move[];
  nodesVisited: number;
};

function findForcedWin(
  store: PatternStore,
  attacker: Player,
  options: { maxPly: number; deadline?: number },
): ForcedWinResult;
```

AND/OR tree (standard TSS):

- **OR node (attacker):** success if *any* threat move leads to a win.
- **AND node (defender):** success for attacker only if *every* legal
  defence reply still loses (i.e. recursive `findForcedWin` succeeds for
  attacker after that reply).
- Terminal win: `checkCaroWin` after an attacker move.
- Terminal fail: no threat moves; or `maxPly` / deadline exhausted without
  a proof (conservative: “not proven,” not “proven draw”).
- Depth: count plies (attacker + defender moves). Suggested default
  `maxPly` for `expert`: **16** (8 attacker moves), shared wall-clock with
  the overall `timeBudgetMs` (TSS gets first claim; remainder goes to
  negamax fallback).

Node counter increments on each place (attacker or defender).

No alpha-beta score ladder inside TSS — only boolean proof + PV of the
first successful attack line (leftmost under the ordered threat list).

## Integration into `search` / `chooseMove`

When `threatSearch` is enabled:

1. Build / reuse `PatternStore` as today.
2. **Own force check first:** `findForcedWin(store, player, ...)`.
   - If `won`, return `pv[0]` with score `WIN_SCORE`-class and the PV.
   - Own win beats defending (same priority as `narrowCandidates` step 1).
3. **Opponent force / must-block:** `findForcedWin(store, opponent, ...)`.
   - If `won`, pass `collectDefenceMoves(store, opponent, player, …)` into
     negamax (or patternOnly when length === 1) as the only root candidates.
4. Else run existing `narrowCandidates` + negamax / patternOnly as today,
   with remaining time budget.

`SearchResult` gains no required new fields in v1; optional later:
`forcedWin: boolean`. For now, a decisive `|score| >= WIN_SCORE` and a long
PV sufficiently signal TSS success. Tests may call `findForcedWin`
directly.

## Testing strategy (TDD)

Fixture helper: existing `parseBoard`.

1. **Open-three → force deeper than 6** — ASCII where the winning first
   move is an open-three critical gain; `findForcedWin` returns `won` with
   that move; `search(..., threatSearch: true)` plays it; `hard` without
   TSS may miss (document if the fixture is also solvable at depth 6 —
   prefer a line that needs >6 plies).
2. **Fork force** — double threat; prover returns the fork cell.
3. **Must-block** — opponent to-move would have a forced win; side to move
   with TSS enabled plays a blocking cell.
4. **No force** — quiet / soft position; `findForcedWin` returns
   `won: false`; `search` falls back and matches non-TSS move family.
5. **Difficulty gate** — `chooseMove(..., { difficulty: "hard" })` does not
   call TSS (spy or behavioral: expert-only fixture where only TSS finds
   the win).
6. **Regression** — existing search / narrow / engine difficulty suites
   stay green; easy/medium/hard unchanged.

## Alternatives considered

- **VCF-only (fours continuous):** simpler, but misses the open-three / fork
  starts that matter under Caro. Rejected for v1 in favor of option A.
- **Option B (add three / open-two):** stronger eventually, much wider AND
  branches; deferred until option A is proven in tests and play.
- **TSS on `hard`:** rejected so hard remains a stable baseline; expert is
  the opt-in stronger / slower mode.
- **TSS-only engine (no negamax):** positionally weak in quiet midgames;
  keep negamax fallback.

## Success criteria

- Expert finds at least one curated long force that hard misses.
- Easy / medium / hard behavior and tests unchanged.
- TSS respects time budget (no hang; incomplete proof → fallback).
- Implementation stays additive: no rearrange of Phase A layering.
