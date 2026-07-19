# UI: default difficulty + persisted undo/redo history

## 1. Default difficulty

`index.html`'s `#difficulty` select currently has `medium` marked `selected`. Move
`selected` to the `hard` option. No other behavior changes — `currentDifficulty()`
in `app.ts` already just reads `difficultyEl.value`.

## 2. Persist undo/redo history across refresh

**Problem:** `app.ts` keeps `past`/`future` as in-memory arrays of full `GameState`
snapshots. The server already persists the *current* `GameState` (`board`,
`nextPlayer`, `moveHistory`, `winner`) via `GET/PUT /api/state`, but `past`/`future`
are never sent, so a page refresh loses undo/redo even though the board itself
reloads correctly.

**Key insight:** `past` is redundant with `moveHistory` — it's just the sequence of
states before each move, reconstructible by replaying `moveHistory` from
`newGame()` through `applyMove`. `future` only needs the *extra* moves that were
undone, in original chronological order; those can be replayed forward from the
current position the same way.

**Design:**

- Add an **optional** `redoMoves?: Move[]` field to `GameState` in `state.ts`.
  Optional so `applyMove` and every engine/search call site (which construct and
  clone `GameState` deep in search recursion) are unaffected — no engine or test
  changes required. `newGame()` does not set it; absence means "no redo history."
- `server.ts` needs no changes: it round-trips whatever JSON body it receives
  (`isValidGameState` only checks the pre-existing required fields), so the new
  field passes through `GET`/`PUT /api/state` for free.
- In `app.ts`, before every `saveState(state)` call, derive `redoMoves` from the
  `future` stack and attach it to the payload:
  `future.length > 0 ? future[0].moveHistory.slice(state.moveHistory.length) : []`.
  `future[0]` (bottom of the stack) always holds the full extended move list
  because `future` is appended to bottom-first as successive undos happen.
- On `init()`, after `fetchState()`:
  1. Rebuild `past` by replaying `loaded.moveHistory` move-by-move from
     `newGame()` via `applyMove`, pushing the pre-move state at each step (mirrors
     `commitState`'s existing push order exactly).
  2. Rebuild `future` by replaying `loaded.redoMoves` forward from the
     reconstructed current state via `applyMove`, collecting each resulting state,
     then reversing that list before assigning to `future` (so the nearest redo
     target ends up on top of the stack — i.e. at the end of the array, matching
     `stepHistory`'s `pop()` semantics).
  3. Rebuild `patternStore` from the current board as today
     (`PatternStore.fromBoard`). No change needed — the first post-reload
     undo/redo simply falls back to `resetFromBoard` inside `syncPatternStore`
     (depth 0 < steps), which is already a safe, existing code path.

**Out of scope:** persisting the selected difficulty; multi-device/multi-tab
sync guarantees beyond what the existing single `state.json` file already
provides.
