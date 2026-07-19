# Caro (Gomoku) Engine — Design

Date: 2026-07-16
Status: approved design, pre-implementation
Methodology: TDD throughout

## Goals

1. A Caro-rules engine that plays offline against a human through the existing
   `GameState` API, with selectable difficulty levels.
2. Long-term: make the engine as strong as feasible, via a phased roadmap
   (threat-space search, transposition tables, incremental evaluation).
3. Later (separate bridge API, deferred until the engine works): produce
   structured analysis data and render it as prompt-ready text briefings so an
   external LLM can play using the engine as its "eyes".

## Rules: Caro variant

- Board 20×20 (existing `BOARD_SIZE`).
- A run of stones wins iff its length is **exactly five** and it is **not
  blocked at both ends** by opponent stones. The board edge does **not** count
  as a block, but a five whose both ends are opponent stones does not win.
- **Overline (six or more) does not win** — a six-run is dead even if it
  contains five consecutive stones.
- Draw: board full (later possibly: no viable five-window remains for either
  side).

## Architecture

```
src/engine/
  board.ts      (exists) low-level board primitives
  rules.ts      NEW  Caro win/legality logic (replaces freestyle checkWin)
  patterns.ts   NEW  line scanning + functional pattern classification
  evaluate.ts   NEW  pattern instances → position score
  search.ts     NEW  negamax + alpha-beta + iterative deepening
  engine.ts     (exists) public chooseMove(state, config) — rewired to search
  state.ts      (exists) immutable GameState — stays the public API
  analysis.ts   LATER  bridge: GameState → AnalysisReport
  report.ts     LATER  AnalysisReport → markdown LLM briefing
```

Dependency direction is strictly downward:
`engine → search → evaluate → patterns → rules → board`.

The immutable `GameState`/`applyMove` remains the outer API for UI/server.
Internally, search operates on a single mutable board copy with place/undo.

## Modeling

```ts
// patterns.ts
type PatternType =
  | 'five'          // winning run (Caro-valid)
  | 'open-four'     // four with ≥2 winning squares — unstoppable
  | 'four'          // four with exactly 1 winning square — forcing, blockable
  | 'open-three'    // three that can become an open-four — severe
  | 'three'         // three that can only make simple fours
  | 'open-two'      // two with room to become an open-three
  | 'two';          // remaining live two

interface PatternInstance {
  type: PatternType;
  player: Player;
  cells: Move[];              // stones forming the pattern
  gains: Move[];              // empty cells that upgrade/complete it
  direction: [number, number];
}

// engine.ts
type Difficulty = 'easy' | 'medium' | 'hard';
interface EngineConfig { difficulty: Difficulty; timeBudgetMs?: number; }
interface SearchResult {
  move: Move;
  score: number;
  depth: number;
  principalVariation: Move[];
  nodesVisited: number;
}
```

`chooseMove` returns the full `SearchResult`; the extra fields feed debugging
and the later LLM bridge.

## Pattern classification: functional, not shape-based

**Decision:** patterns are classified by *win-square counting over sliding
5-windows*, not by matching enumerated shape strings. Shape strings
(`.XXXX.`, `O.XXX.`, …) appear only in tests and documentation as examples.

Definitions:

- A **viable window** for player P is 5 consecutive cells in one direction
  containing no opponent stone, where filling it with P's stones would produce
  a *Caro-legal* five (not blocked both ends, not part of an overline).
- A **win square** of a four is an empty cell whose occupation completes a
  Caro-legal five.
- **four**: 4 stones inside a viable window. `winSquares ≥ 2` → `open-four`
  (unstoppable); `= 1` → `four`; `= 0` → dead (not reported).
- **open-three**: a three for which some gain move produces a four with
  `winSquares ≥ 2`. Otherwise, if it can still make fours at all → `three`;
  if no viable window contains it → dead.
- Twos analogously, one level down.

Worked examples under Caro rules (right side open unless noted):

| Shape | Classification | Why |
|---|---|---|
| `OXXX.` | three | Only simple fours possible; `OXXXXX` (five blocked one end) does win in Caro. |
| `O.XXX.` | open-three | Playing the right end yields `O.XXXX.` with **two** win squares (gap + far end). |
| `O..XXX.` | open-three | Same mechanism through the gaps; positionally weaker. |
| `O.XXXO` | dead | No viable window. |
| `.XXXXX.` +1 more X | dead | Overline. |

The functional definition makes these fall out automatically instead of being
hand-enumerated, and it inherently respects the blocked-ends and overline
rules.

## Cross-line combination threats (forks)

**Decision: derived, not first-class patterns.** Forks (double-four,
four + open-three, double-open-three across intersecting lines) are computed
from single-line `PatternInstance` data:

- A **fork point** is an empty cell appearing in the `gains` of ≥2 severe
  patterns of the same player in different directions.
- Severity: double-four and four+open-three are winning; double-open-three is
  winning unless the opponent holds a faster forcing threat.

`findForkPoints(patterns)` feeds move ordering, the phase-B threat search, and
LLM briefings. Regular alpha-beta search also discovers forks naturally 2–3
plies deep — the derived detection is an accelerator, not a correctness
requirement.

## Evaluation (`evaluate.ts`)

- `evaluate(board, playerToMove)`: sum of pattern scores for both sides with a
  tempo asymmetry — the side to move gets a multiplier on its threats (a four
  for the mover is a win next turn).
- The score table is a single exported constant: tuning is data, not code.
- Terminal positions (Caro five present) short-circuit to ± large values
  scaled by remaining depth, so faster wins score higher.

## Search and difficulty (`search.ts`, `engine.ts`)

- Negamax with alpha-beta pruning over candidate moves (empty cells within
  distance 2 of any stone; full board fallback when empty).
- **Move ordering** (the main strength lever): own winning moves, blocks of
  opponent fours, own fours, fork points, open threes, then by static score.
- **Iterative deepening** under a time budget; return best-so-far on expiry.
- Difficulty mapping:
  - `easy`: depth 2, trimmed candidate set, slight randomness among
    near-equal moves.
  - `medium`: depth 4.
  - `hard`: depth 8 with ~1–2 s budget (plus every later roadmap phase).

## Roadmap to maximum strength (post-A phases, all additive)

1. **Phase B — threat-space search**: `findForcedWin(board, player)` that
   searches only forcing sequences (option A: fours, open-three critical
   gains, recognized forks). Runs before regular search at `expert` (not
   hard). Detailed design: `2026-07-19-threat-space-search-design.md`.
2. **Phase C1 — transposition table** (Zobrist hashing) + killer/history move
   ordering.
3. **Phase C2 — incremental pattern/eval updates** on place/undo instead of
   full rescans (biggest speed win → deeper search in the same budget).
4. **Phase C3 — typed-array board** if profiling still demands it; opening
   book; self-play tuning of the score table.

Nothing in the phase-A architecture gets rearranged by these phases; they plug
into existing seams.

## Testing strategy (TDD)

- **Test fixture helper first**: `parseBoard(ascii)` turning ASCII diagrams
  (`.`, `X`, `O`) into `Board`, so every test reads like a picture.
- **rules**: table-driven Caro win cases — blocked one end, blocked both ends,
  board-edge ends, overline, overline containing a clean five, wins through
  the just-placed stone only.
- **patterns**: ASCII fragments → exact expected `PatternInstance` sets,
  including the worked examples above and fork-point derivation.
- **evaluate**: relative assertions only (open-four position > open-three
  position); never absolute score values.
- **search**: tactical puzzle suite — win-in-1, must-block, win-in-3 via
  double threat — each with a unique correct move; candidate-generation
  sanity checks.
- **engine**: difficulty smoke tests (hard beats easy over N self-play games;
  time budget respected).

## LLM bridge (deferred — interface reserved)

`analysis.ts` will expose `analyze(state): AnalysisReport` containing the
board diagram data, both sides' `PatternInstance[]`, fork points, forced-win
status, and top-k `SearchResult`s. `report.ts` renders it to a markdown
briefing. The core requires no changes to add this — the structured pattern
layer is the shared vocabulary.

## Alternatives considered

- **Threat-space-search-first architecture**: stronger tactically at first but
  positionally weak, harder difficulty tuning; adopted instead as Phase B on
  top of the layered engine.
- **Performance-first (bitboards, incremental eval from day one)**: premature;
  plain TS with good move ordering reaches depth 4–8 on 20×20 comfortably.
  Adopted as Phase C only where profiling justifies it.
- **Shape-string pattern matching**: rejected in favor of functional
  win-square classification (see above) — Caro's blocked-ends and overline
  rules make enumerated shapes error-prone.
