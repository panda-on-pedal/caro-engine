# Pattern-Driven Candidate Narrowing — Design

Date: 2026-07-17
Status: approved design, pre-implementation
Methodology: TDD throughout

## Background

Manual playtesting of the negamax engine (`docs/superpowers/plans/2026-07-16-gomoku-engine-implementation.md`)
surfaced that it frequently fails to block an opponent's open three, never
builds forks, and always opens with the same relative move. Root-cause
debugging (this session) found the underlying mechanism: `findPatterns`
recomputes from scratch, twice, at every single search node (including
recursive rescans inside `criticalGains` checks), costing tens of
milliseconds per node on the real 20×20 board. Under any realistic time
budget, `negamax`'s per-node candidate loop — which tries all ~50 raw
candidate cells in a fixed board-scan order — runs out of budget after only
a few dozen nodes, frequently **before it ever reaches the move that
matters**, because move ordering only prioritizes blocking a `four`/
`open-four`, not a `three`/`open-three`, and nothing prioritizes fork
defense at all.

The fix is not "search deeper" (the per-node cost makes that infeasible) —
it's to stop searching blindly. The pattern catalog (`patterns.ts`) already
computes, once per position, exactly which lines are dangerous and which
moves address them. This design uses that data to **narrow** the candidate
set before searching, instead of only using it to *order* an unfiltered set.

## Goals

1. Reliably block/exploit `four`/`open-four` (forced) and `three`/
   `open-three` (tactical) patterns — for both players — without depending
   on search depth to "discover" them.
2. Recognize opponent forks (mirrored fork defense), gated by an explicit,
   testable, per-difficulty catalog rather than an all-or-nothing rule.
3. Fast, varied opening play: no wasted deep search when no tactical pattern
   exists yet, and no more deterministic "always the same relative first
   move."
4. Keep the fix swappable: the move-selection stage (currently negamax)
   must be pluggable, so a test (or a future algorithm) can bypass search
   entirely and use pattern narrowing alone.
5. Non-goals for this design: the full VCF/VCT forced-win search
   (`findForcedWin`) from the original roadmap's Phase B remains future
   work — this design's node-level narrowing captures most of its practical
   value (forced win/block recognition) at a fraction of the complexity.
   `patterns.ts`'s per-node recomputation cost itself (Phase C2,
   "incremental pattern/eval updates") is also not addressed here; this
   design routes around it by shrinking the branching factor rather than
   the per-node cost.

## Architecture

```
src/engine/
  board.ts        (exists) low-level board primitives
  rules.ts         (exists) Caro win/legality logic
  patterns.ts       (exists) line scanning + functional pattern classification
  randomize.ts      NEW  pure, game-agnostic weighted-random helpers
  narrow.ts         NEW  pattern-tiered candidate selection + fork catalog
  evaluate.ts       (exists) pattern instances → position score
  search.ts         REWORKED  negamax now narrows via narrow.ts at every
                     node; top-level search() takes a pluggable strategy
  engine.ts         REWORKED  difficulty now maps to (line-pattern ladder is
                     always full; fork catalog allow-list; depth)
  state.ts          (exists) immutable GameState — stays the public API
```

Dependency direction is still strictly downward, with `randomize.ts` as a
new floor: `engine → search → narrow → evaluate → patterns → rules → board`,
and `randomize.ts` sitting below everything (it imports nothing from this
codebase — no `Board`, `Player`, or `Move` types — so it stays reusable
outside Caro entirely).

## `randomize.ts` — pure weighted-random helpers

```ts
/** Chebyshev-distance decay weight. distance=1 -> 1, always. */
function distanceWeight(distance: number, decayRate: number): number;
// = decayRate ** (distance - 1)

interface DecayConfig {
  startDecay: number;  // decayRate used at moveCount = 0 (most exploratory)
  minDecay: number;    // floor, never goes below this
  stepDown: number;    // linear decrease per move played
}

/** decayRate shrinks as the game progresses, sharpening distanceWeight
 * toward "adjacent cell only" over time. */
function decayRateForMoveCount(moveCount: number, config: DecayConfig): number;
// = max(config.minDecay, config.startDecay - config.stepDown * moveCount)

/** Weighted random selection. `rng` defaults to Math.random but is
 * injectable so tests can assert exact picks deterministically. */
function weightedPick<T>(
  items: readonly T[],
  weights: readonly number[],
  rng?: () => number,
): T;
```

No board, player, or move types appear anywhere in this file — it is a
generic weighted-sampling utility that happens to be used for Caro move
selection, not a Caro-specific module.

## `narrow.ts` — pattern-tiered candidate selection

```ts
interface NarrowConfig {
  recognizedForkPatterns: ReadonlySet<ForkPatternName>; // see catalog below
  decay: DecayConfig;
  rng?: () => number;
}

function narrowCandidates(
  board: Board,
  player: Player,
  moveCount: number,
  config: NarrowConfig,
): Move[];
```

Algorithm, in order:

1. **I can win now.** If my patterns include a completable `four`/
   `open-four`, return just its gain cell(s). (The line-pattern ladder —
   `two` through `five` — is always fully recognized at every difficulty;
   only fork recognition is difficulty-gated. See Difficulty Model below.)
2. **I must block now.** Else, if the opponent has a completable `four`/
   `open-four`, return just its blocking gain cell(s) — every other move
   provably loses next turn.
3. **Tactical set.** Else, collect a small priority set: own fork points
   matching a recognized catalog entry, opponent fork points matching a
   recognized entry (**defense** — the same catalog, checked against the
   opponent's patterns), own `open-three` extensions, opponent `open-three`
   blocks. Ties within this set are broken by `weightedPick` using
   `decayRateForMoveCount(moveCount, config.decay)`.
4. **Quiet fallback.** If nothing tactical was found, sample a handful of
   cells from the raw radius-2 neighborhood via `weightedPick` +
   `distanceWeight`, using the same decay-by-move-count. This is what makes
   the opening fast (small candidate set, no wasted deep search) and varied
   (sampled, not a fixed scan-order pick).

`narrow.ts` sits below `search.ts`: it depends on `patterns.ts`
(`PatternInstance`, `findForkPoints`) and `randomize.ts`, and is consumed by
`search.ts`'s `negamax`, called at **every** node (not just the root) — the
branching-factor fix applies throughout the tree.

## Fork catalog — named, ASCII-documented, functionally matched

Each catalog entry is a **named, separately-testable geometric shape**,
documented with an illustrative ASCII example (matching this codebase's
existing convention in `patterns.spec.ts`), but matched against
already-computed `PatternInstance` data (type, direction, relative
position) — not raw board-character scanning. This keeps the "functional,
not shape-based" principle from the original design intact (Caro's
blocked-ends/overline rules make raw shape strings error-prone for *line*
classification; fork *composition* from already-correct line data does not
carry that risk) while still giving precise, testable, per-difficulty
control over which shapes are recognized.

```ts
type ForkPatternName = string; // e.g. "cross-double-three"

interface ForkPatternDef {
  name: ForkPatternName;
  example: string;   // ASCII diagram, for documentation and test fixtures
  matches: (patterns: PatternInstance[]) => ForkPoint[];
}

const FORK_PATTERNS: readonly ForkPatternDef[]; // e.g.:
// - "cross-double-three": two open-two patterns, one horizontal one
//   vertical, sharing a criticalGain
// - "diagonal-double-three": two open-two patterns at a diagonal relative
//   offset, sharing a criticalGain
// - ...additional entries added during implementation, each with its own
//   ASCII fixture
```

The exact full enumeration (how many entries beyond the two illustrated
above, and their precise relative geometries) is finalized during
implementation via TDD fixtures — this design fixes the **mechanism**
(named + ASCII-documented + functionally-matched + per-difficulty
allow-listed), not the final list.

## Pluggable move-selection strategy

```ts
// search.ts
export type MoveSelectionStrategy = (
  board: Board,
  player: Player,
  candidates: Move[],   // pre-narrowed by narrowCandidates
  config: SearchConfig,
) => SearchResult;

export const negamaxStrategy: MoveSelectionStrategy; // default: negamax
                                                        // over the narrowed
                                                        // set at every node
export const patternOnlyStrategy: MoveSelectionStrategy; // zero-lookahead:
                                                        // take narrowing's
                                                        // top pick directly

export function search(
  board: Board,
  player: Player,
  config: SearchConfig,
  strategy?: MoveSelectionStrategy, // defaults to negamaxStrategy
): SearchResult;
```

`negamaxStrategy` reuses the existing, already-correct `negamax`
implementation, but its recursive move loop now calls `narrowCandidates`
instead of `findCandidateMoves` + `orderMoves` — same algorithm, drastically
smaller branching factor at every node. `patternOnlyStrategy` exists for
testing and comparison (e.g., verifying `narrowCandidates` alone produces
sound moves, or benchmarking against the full hybrid) and requires no
changes anywhere else in the engine to swap in.

## Difficulty model

The line-pattern ladder (`two` → `open-two` → `three` → `open-three` →
`four` → `open-four` → `five`) is always fully recognized, at every
difficulty — it is the baseline, not a difficulty lever. Only **fork
recognition** is difficulty-gated, via an explicit named allow-list from
`FORK_PATTERNS`:

| Difficulty | Line-pattern ladder | Fork catalog | Depth (over narrowed set) |
|---|---|---|---|
| easy | full (two → five) | none | 2 |
| medium | full | 2 named entries | 4 |
| hard | full | all remaining entries | 6 |

(`hard`'s depth of 6, versus the original plan's unreachable-in-practice 8,
is a starting default — narrowing makes deeper search far cheaper than
before, so this may be re-tuned upward via self-play evidence during
implementation, the same way `PATTERN_SCORES` tuning is data rather than a
fixed decision baked into this design.)

Fork catalog entries apply symmetrically: the same allow-list is checked
against both the mover's own patterns (offense) and the opponent's
(defense), since each entry is a geometric shape independent of which
player holds it.

`SearchConfig` gains the fields needed to carry this through to every
`narrowCandidates` call inside `negamax` (both flow from `engine.ts`'s
per-difficulty map — `recognizedForkPatterns` from the table above,
`decay` from a single exported `DecayConfig` constant per difficulty,
consistent with the existing `PATTERN_SCORES`-is-data convention):

```ts
interface SearchConfig {
  maxDepth: number;
  timeBudgetMs?: number;
  recognizedForkPatterns: ReadonlySet<ForkPatternName>;
  decay: DecayConfig;
}
```

## Randomization: where it applies

The same `distanceWeight` + `decayRateForMoveCount` + `weightedPick`
mechanism is used in exactly two places in `narrow.ts`:

1. **Quiet-position fallback** (opening or any pattern-free position): picks
   which small subset of the radius-2 neighborhood becomes the candidate
   set, weighted toward cells close to existing stones.
2. **Tie-breaking within the tactical set**: when multiple candidates end
   up equally ranked after the tactical/fork checks (e.g. several moves
   that equally extend an open-two), instead of always taking the first in
   scan order.

`decayRateForMoveCount` ties both to the same `moveCount` input, so variety
naturally fades as the game matures and real tactical patterns increasingly
dominate the tie-break — no separate "first N moves only" special case is
needed.

## Testing strategy (TDD)

- **`randomize.ts`**: pure unit tests on `distanceWeight` (monotonic
  decreasing in distance, `distance=1` always yields `1`) and
  `decayRateForMoveCount` (monotonic non-increasing, clamped at `minDecay`).
  `weightedPick` tested with an injected fixed `rng` sequence, asserting
  exact picks — fully deterministic, no flaky randomness in CI.
- **`narrow.ts`**: ASCII fixture tests per tier — a `four` position returns
  only its gain cell; an opponent `four` returns only the block; each
  `FORK_PATTERNS` entry gets its own ASCII fixture pinning a match, plus a
  fixture proving a *medium*-difficulty config does **not** match a
  hard-only entry; a quiet position asserts the sampled set's size and
  locality (not exact cells, since it's randomized — assert membership
  within the expected radius, not identity).
- **`search.ts`**: swap in `patternOnlyStrategy` and assert `nodesVisited`
  stays near-zero, proving the pluggable seam actually decouples narrowing
  from search; re-run this session's exact regression scenarios (unblocked
  open three, no forking, deterministic first move) and assert they now
  resolve correctly; existing `negamax`/`orderMoves` specs updated for the
  new candidate source (`orderMoves` may be removed entirely if
  `narrowCandidates` fully subsumes its role — confirmed during
  implementation).
- **Full-branch regression**: re-run `engine.difficulty.spec.ts` — expect
  it to become *more* reliable than before (less flaky), since "hard" now
  actually reaches its nominal depth instead of stalling at depth 1 on the
  real board.

## Alternatives considered

- **Full VCF/VCT threat-space search (original roadmap Phase B)**: a
  dedicated `findForcedWin(board, player)` that exhaustively proves forced
  win/loss sequences many plies deep. More powerful in principle (can prove
  forced outcomes negamax can't reach at all), but a substantially larger
  and riskier algorithm to get right. Deferred — the node-level narrowing
  in this design captures the practical value (forced win/block, and most
  fork situations) at much lower implementation risk, and remains additive
  with a future VCF/VCT layer if still wanted later.
- **Depth-only difficulty (unchanged from the original plan)**: keep
  `easy`/`medium`/`hard` as pure depth 2/4/8 and rely on narrowing purely
  as a performance fix. Rejected because it doesn't explain difficulty in
  human terms (a beginner doesn't calculate 8 plies deep with a narrower
  search — they simply don't *see* forks coming), and the fork-catalog
  gating gives a much more legible, individually testable difficulty knob.
- **Raw ASCII shape-matching for forks** (literal character-grid template
  scanning): rejected for the same reason the original design rejected it
  for line patterns — Caro's blocked-ends/overline rules make raw shapes
  error-prone. ASCII is kept as the specification/documentation format
  only; matching stays functional, over `PatternInstance` data.
