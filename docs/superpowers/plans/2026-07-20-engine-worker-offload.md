# Offload AI search to a Web Worker (fix page freeze)

## Context

On expert difficulty the engine searches for up to 10 s (`timeBudgetMs: 10000`) and the page freezes — no clicks, no button response. Cause: **no worker offloading exists anywhere** (it was only proposed in a plan doc, never implemented). `runAiMove` (`src/ui/app.ts:360`) calls `chooseMove` (`src/engine/engine.ts:93`) synchronously on the main thread, and the search loop in `src/engine/search.ts` / `threatSearch.ts` never yields to the event loop.

Fix: run the search in a dedicated Web Worker. The engine stays untouched — the board/state is plain JSON, so it's structured-clone safe. Build is esbuild (not Vite), so the worker gets its own bundle entry served by the Node server.

**Alignment with `2026-07-19-parallel-ai-ai-tournament-plan.md`:** this plan is deliberately a strict prefix of that plan — it implements its steps 3–4 ("Worker + pool + build" and "Route existing modes through the pool" with a size-1 pool). Same file names (`engineProtocol.ts`, `engineWorker.ts`, `enginePool.ts`), same wire protocol (`board`/`player`, not full `GameState`), same build script and `STATIC_FILES` entry, same `CancelledError` + generation-guard cancellation pattern. When the tournament lands, it only grows the pool size and adds tournament logic on top — nothing here gets thrown away or conflicts. One deliberate amendment to the tournament plan's `cancelAll()`: it must also **terminate + respawn busy workers**, because with a 10 s expert search a size-1 pool would otherwise delay the next game's first move by up to 10 s (the tournament plan tolerated orphan searches only because its budgets are ≤1 s). Note this amendment inline in the tournament plan doc when implementing.

## Files

### New: `src/ui/engineProtocol.ts` — wire types + pure handler (testable)

Types exactly as the tournament plan sketches, response widened to the full `SearchResult` (superset of its move/score/depth — still compatible):

```ts
export interface EngineRequest {
  id: number; board: Board; player: Player; difficulty: Difficulty; timeBudgetMs?: number;
}
export type EngineResponse =
  | { id: number; ok: true; result: SearchResult }
  | { id: number; ok: false; error: string };

export function handleEngineRequest(request: EngineRequest): EngineResponse {
  // search(board, player, resolveEngineSearchConfig({ difficulty, timeBudgetMs })) in try/catch
}
```

Imports: `search`/`SearchResult` from `../engine/search.ts` (engine.ts does not re-export `SearchResult`), `resolveEngineSearchConfig` from `../engine/engine.ts`.

### New: `src/ui/engineWorker.ts` — thin worker shell

Casts `self` to a minimal local scope interface (`onmessage` + `postMessage`) via `unknown`. Do **not** use `/// <reference lib="webworker" />` — the single tsconfig program uses `lib: ["ES2022", "DOM"]` and a webworker lib reference would conflict repo-wide (tournament plan agrees: "narrow local cast"). `onmessage` → `postMessage(handleEngineRequest(event.data))`.

### New: `src/ui/enginePool.ts` — `EnginePool` class (size 1 for now)

Constructor takes `size` (app.ts passes 1). FIFO queue + `pending: Map<id, {resolve, reject}>`, per tournament plan:

- `requestMove(board, player, difficulty, timeBudgetMs?): Promise<SearchResult>` — dispatch to an idle worker or enqueue.
- `export class CancelledError extends Error` sentinel.
- `cancelAll()` — clear queue, reject all pending with `CancelledError`, and (amendment) **terminate + respawn any busy worker** so a stale 10 s expert search can't delay the next game. Idle workers survive. Rejection is required, not polish: a hanging await would leave `autoplayRunning = true` forever (the autoplay loop's `finally` never runs) and wedge ai-ai after any mid-think reset.
- `terminate()` — kill all workers (future pool-resize; unused by app.ts for now beyond symmetry).
- Worker `onerror` (e.g. bundle 404): `logger.error(...)`, reject that worker's in-flight request with a real `Error` (not `CancelledError`), respawn lazily.
- Stale responses: `onmessage` looks up `pending` by id and ignores unknown ids.

### `src/ui/app.ts`

- Import `EnginePool`/`CancelledError`; module-level `const pool = new EnginePool(1);` replace the `chooseMove` import (keep `type Difficulty`).
- `runAiMove` (line 360): replace the sync call with
  `await pool.requestMove(state.board, player, difficultyForPlayer(player))`.
  **Re-check `myGeneration !== generation` after the await, before touching `busy` or committing** — the old comment (lines 355–359) relied on `chooseMove` being synchronous; rewrite it. Catch: `CancelledError` (or stale generation) → return silently, reset already restored `busy`; genuine error → `busy = false; render(); throw` (every call path already has `.catch → logger.error`: board listener, undo/redo/new-game/mode listeners, `togglePause`, `init`).
- `resetForMode` (line 436): add `pool.cancelAll()` right after `generation += 1;`.

### `package.json`

```json
"build": "esbuild src/ui/app.ts --bundle --outfile=main.js && esbuild src/ui/engineWorker.ts --bundle --outfile=engineWorker.js"
```

(Verbatim from the tournament plan.) Two chained `--outfile` invocations — multi-entry `--outdir` would rename `main.js` → `app.js`. esbuild's default IIFE output is what classic `new Worker('/engineWorker.js')` needs; do not add `--format=esm`.

### `src/server/server.ts`

Add `'/engineWorker.js': 'engineWorker.js'` to `STATIC_FILES` (line 11). `.js` MIME already exists.

### `docs/superpowers/plans/2026-07-19-parallel-ai-ai-tournament-plan.md`

Mark steps 3–4 as done by this work and note the `cancelAll()` terminate-busy-workers amendment, so the tournament plan doesn't re-implement or contradict it.

### Ignore files

`main.js` is **gitignored, not tracked** — treat `engineWorker.js` identically: add to `.gitignore` and to the `ignores` array in `eslint.config.mjs`.

### New: `src/ui/engineProtocol.spec.ts`

- Mid-game board + `easy` → `ok: true`, echoes `id`, move is a legal empty cell; `timeBudgetMs` override respected (e.g. tiny budget still returns a move).
- Skip unit tests for engineWorker/enginePool/app wiring — repo convention leaves DOM glue untested (`testEnvironment: 'node'`, no `Worker` global); manual E2E covers it.

## Button behavior while the worker is thinking (by design)

Today none of these handlers even run — the browser queues the click until the 10 s search finishes (that's the freeze). After this change every handler runs instantly:

- **Board cells / Undo / Redo**: handler runs but early-returns on `busy` (`app.ts:452,484,494`) — intentionally ignored so the position can't change under the in-flight search. No freeze, just no-op.
- **New Game / mode select**: `resetForMode` runs immediately — generation bump + `pool.cancelAll()` kills the stale search; the awaiting `runAiMove` rejects with `CancelledError` and exits silently; the fresh game (and its first AI move, if AI starts) begins promptly.
- **Pause (ai-ai)**: flag flips instantly; the one in-flight move still lands, then the loop stops — same semantics as today.
- **Difficulty selects / ASCII toggle**: respond immediately; a difficulty change applies from the next AI request (read at request time, unchanged).

## Verification

**Do not run the full test suite (`npm test`) — the engine search specs are slow.** Run only the tests touching this change:

1. `npm run typecheck`, `npm run lint`, `npx jest src/ui/engineProtocol.spec.ts` (the sole new spec; no engine code changes, so engine specs are unaffected).
2. `npm start` → http://localhost:3000; Network tab shows `/engineWorker.js` 200.
3. Expert mode, make a move: during "AI thinking…" the page stays responsive (hover, ASCII toggle, buttons); cell/undo/redo clicks correctly no-op via `busy` but nothing freezes.
4. Mid-think, click New Game / switch mode: new game starts immediately; next AI move is prompt (not delayed ~10 s by the orphaned search); no stale stone lands.
5. ai-ai expert vs expert: autoplay runs, Pause/Resume works, New Game mid-think + resume does not wedge autoplay.
