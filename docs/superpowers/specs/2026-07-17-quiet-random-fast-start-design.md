# Quiet Random Fast-Start + Open-Two Tactical Narrowing — Design

Date: 2026-07-17
Status: approved design, pre-implementation
Methodology: TDD throughout
Extends: `2026-07-17-pattern-driven-search-design.md`

## Background

After the pattern-driven narrowing work, quiet openings still run full
iterative-deepening negamax over a distance-weighted sample of the
radius-2 neighborhood. That wastes time when no line pattern exists yet,
and does not match the intended “if the human is still playing randomly,
the AI answers randomly (near existing stones)” feel.

Separately, `narrowCandidates` Step 3 only promotes `open-three`
`criticalGains` (plus recognized forks). Plain `open-two` lines are
ignored, so defense often starts only when an open-three appears — too
late against forcing sequences built from open-twos.

## Goals

1. **Quiet = random only.** When the position has no four / open-four /
   open-three / open-two / recognized fork for either side, pick one
   distance-weighted random move from the existing quiet-fallback
   neighborhood sample. Do **not** run negamax.
2. **Open-two counts as tactical.** Own and opponent `open-two`
   `criticalGains` join Step 3. Presence of an open-two ends quiet mode
   and those cells enter the search candidate set.
3. Keep forced win/block (Step 1/2) and existing open-three / fork
   behavior unchanged.
4. No public `chooseMove` API change; quiet picks still return a
   `SearchResult` with `depth: 0`.

## Non-goals

- First-stone-only distance reweighting (quiet fallback already weights by
  nearest existing stone; after one stone that is the first cell).
- Difficulty-gating open-two recognition (always on, like open-three).
- Skipping search for quiet positions discovered mid-tree inside negamax
  (root-only short-circuit).
- Uniform random over the whole empty board.

## Behavior

| Position | Engine action |
| --- | --- |
| Quiet (no four / open-three / **open-two** / recognized fork either side) | Distance-weighted random among radius-2 neighborhood of existing stones (≤8 sample as today). No search. `depth: 0`. |
| Open-two or stronger tactical present | Open-two `criticalGains` (own + opponent) in Step 3 with forks + open-three. Full negamax. |
| Four / open-four | Unchanged forced win/block short-circuit. |

“Around its cells” means the existing quiet fallback: neighborhood of
**all** stones, nearer preferred — not a dedicated first-cell-only rule.

## Architecture

```
narrow.ts   — Step 3 adds open-two criticalGains; returns tagged NarrowResult
search.ts   — root: quiet → patternOnlyStrategy; forced/tactical → negamax
engine.ts   — unchanged public surface (chooseMove → search)
```

### `narrow.ts`

```ts
type NarrowSource = "forced" | "tactical" | "quiet";

type NarrowResult = {
  moves: Move[];
  source: NarrowSource;
};
```

- Step 1/2 → `source: "forced"`.
- Step 3 (forks + open-three + **open-two** criticalGains, both players) →
  `source: "tactical"` when the set is non-empty.
- Step 4 quiet sample/reorder → `source: "quiet"`.

Call sites that only need the move list use `.moves`.

### `search.ts`

- `search()` inspects `source` at the **root**:
  - `quiet` → `patternOnlyStrategy` (first of the already
    weighted-sampled/reordered list = one distance-weighted random pick).
  - `forced` / `tactical` → `negamaxStrategy` as today.
- An explicit `strategy` argument still overrides (tests / future algos).
- Recursive negamax nodes call `narrowCandidates(...).moves` only; they do
  not apply the quiet root short-circuit.

### `engine.ts` / UI

No change. Quiet replies report `depth: 0`, `nodesVisited: 0`.

## Testing

### `narrow.spec.ts`

- Open-two only (no open-three / fork / four): `source === "tactical"` and
  moves include that open-two’s `criticalGains` (own and/or opponent
  fixtures).
- Truly quiet (one stone, no patterns): `source === "quiet"`, moves ⊆
  radius-2 neighborhood, size ≤ 8.

### `search.spec.ts` / `engine.spec.ts`

- Quiet board after first stone: `chooseMove` / `search` returns
  `depth: 0`, `nodesVisited: 0`, move legal and in the neighborhood —
  proves no negamax.
- Board with an open-two: `depth > 0` (search runs); when open-two is the
  only tactical set, the chosen move is among those `criticalGains`
  (injectable `rng` where needed).

## Implementation notes

- Prefer extending the existing Step 3 loops rather than a parallel open-two
  path.
- Update any call sites of `narrowCandidates` that assume `Move[]` to use
  `.moves` (or adapt helpers).
- Existing empty-board / difficulty tests that assert `depth > 0` on empty
  or single-stone boards must be revised for quiet random (`depth: 0`).
