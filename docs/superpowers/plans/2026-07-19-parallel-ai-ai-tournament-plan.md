# Parallel AI-vs-AI Tournament Mode with Result Auditing

## Context

ai-ai mode currently plays one game on one board and stops when it ends. The goal is to turn it into a parallel tournament: N boards (user-selected) play concurrently, each finished game auto-restarts on the next pairing from a shared rotation over the 6 **ordered** difficulty pairings (hard→medium, medium→hard, medium→easy, easy→medium, hard→easy, easy→hard — order matters because the first player has an advantage). Every finished game is appended to a server-side `results.json` for auditing, and the UI shows an aggregated win-rate table per ordered pairing. Alongside this, the page gets a 2-column layout refresh (empty notebook margin left of the red line, narrow logo column right of it, board + buttons to the right of the board, tabs for boards).

Key verified facts driving the design:
- `chooseMove(state, config)` (`src/engine/engine.ts:67`) is **pure and synchronous** — no module-level state; `search()` builds a fresh `PatternStore.fromBoard()` per call (`src/engine/search.ts:441`). **No engine class refactor is needed**; boards are trivially independent.
- But it blocks the main thread up to 5s on hard (`DIFFICULTY_TIME_BUDGET_MS` 500/2000/5000, depth 2/4/6). **Web Workers are required**, not optional, for multi-board.
- `GameState` is plain JSON (`serializeState` = JSON.stringify) — safe to `postMessage`.
- Build: `esbuild src/ui/app.ts --bundle --outfile=main.js` (single entry); server (`src/server/server.ts`) whitelists static files in `STATIC_FILES` and already maps `.js` → `text/javascript`.
- Reproducible seeding (engine uses `Math.random` internally) is **out of scope**.

## Architecture Decisions

### Worker pool (not one worker per board)
Fixed pool sized `Math.max(1, Math.min(boardCount, (navigator.hardwareConcurrency || 4) - 1))` with a FIFO job queue. Rationale: search deadlines are wall-clock; oversubscribing cores would silently shallow the search — and hurt `hard` (biggest budget) most, **biasing the very win rates we're measuring**. A pool caps concurrency at physical parallelism; queued boards just wait. Recreate the pool when board count changes.

Protocol (`src/ui/engineProtocol.ts`):
```ts
interface EngineRequest { id: number; board: number[][]; player: 1|2; difficulty: Difficulty; timeBudgetMs: number }
type EngineResponse =
  | { id: number; move: {row:number; col:number}; score: number; depth: number }
  | { id: number; error: string };
```

`src/ui/enginePool.ts` — `EnginePool` class: `requestMove(board, player, difficulty, timeBudgetMs): Promise<…>`, `cancelAll()` (clears queue, drops late responses via a `pending: Map<id,…>` check, rejects with a `CancelledError` sentinel), `terminate()` (only on resize). Cancellation reuses app.ts's existing `generation` guard pattern (`app.ts:44`): resets bump `generation` + `cancelAll()`; loops re-check `myGeneration` after every `await`. A search already running in a worker can't be interrupted (sync) — its result is simply dropped; worst case one ≤1s wasted search per worker.

### Tournament fast mode
`src/ui/tournament.ts`: `TOURNAMENT_TIME_BUDGET_MS = { easy: 250, medium: 500, hard: 1000 }` passed as `timeBudgetMs` override; think delay 0 in ai-ai. Depth caps and fork-pattern gating untouched, so the difficulty gap remains. Human modes keep the 300ms delay and default budgets but also route through the pool (UI never blocks).

### Pairing rotation (pure, testable)
```ts
export const PAIRINGS = [['hard','medium'],['medium','hard'],['medium','easy'],['easy','medium'],['hard','easy'],['easy','hard']] as const;
export function pairingAt(counter: number) { return PAIRINGS[counter % PAIRINGS.length]; }
```
One global `pairingCounter` in app.ts; each board takes `pairingAt(pairingCounter++)` at every game start, so pairings interleave fairly across boards regardless of game length.

### BoardSession (UI-layer refactor of app.ts globals)
```ts
interface BoardSession {
  id: number; state: GameState; p1: Difficulty; p2: Difficulty;
  busy: boolean; gameStartMs: number; gamesPlayed: number; loopRunning: boolean;
}
```
- Stays global: `mode`, `generation`, `autoplayPaused` (**Pause pauses ALL boards**), `pairingCounter`, `sessions: BoardSession[]`, `activeIndex`, `pool`. Human-only globals stay global: `past`/`future`, `patternStore` (human modes always use exactly `sessions[0]`).
- Becomes per-session: `runAiMove(session)` (awaits pool), the autoplay loop, commits.
- **ai-ai mode**: Undo/Redo hidden; `/api/state` persistence skipped (no save/load); `patternStore`/`logPatterns` skipped.
- Per-session tournament loop:
```
while generation matches && mode==='ai-ai' && !autoplayPaused:
  if session.state.winner !== null:
      POST result → refresh stats panel
      session.p1/p2 = pairingAt(pairingCounter++); state = newGame(); gameStartMs = now
      renderTabs(); if active → render()
  else: await runAiMove(session)
```

### Rendering N boards — one shared board DOM
Keep the single `#board` grid; only `sessions[activeIndex]` renders into it (existing `render()` already redraws all cells from state, so tab switch = `activeIndex = i; render()`). Hidden boards only update their tab button (pairing label, move count, status dot) via cheap `renderTabs()`. No per-board DOM grids.

### Results recording — shared module + simple server append
`src/shared/results.ts` (imported by server via strip-types, UI, and tests):
```ts
interface GameResult { p1: Difficulty; p2: Difficulty; winner: 1|2|'draw'; moves: number; durationMs: number; endedAt: string }
function isValidGameResult(v: unknown): v is GameResult
interface PairingStats { p1; p2; games; p1Wins; p2Wins; draws; p1WinPct }
function aggregateResults(records: GameResult[]): PairingStats[]  // one row per PAIRINGS entry, in order
```
Server: `RESULTS_PATH = join(ROOT, 'results.json')` ensured as `[]` at startup (mirror `ensureStateFile`, `server.ts:23`). `POST /api/results` validates (400 on bad payload), then read-parse-push-write of the array, serialized with a promise-chain lock (`resultsWriteChain = resultsWriteChain.then(doAppend)`) since N boards can post concurrently. `GET /api/results` streams the file as JSON. 405 + `Allow: GET, POST` otherwise (mirror the `/api/state` branch, `server.ts:103-115`).

### Build
```json
"build": "esbuild src/ui/app.ts --bundle --outfile=main.js && esbuild src/ui/engineWorker.ts --bundle --outfile=engineWorker.js"
```
Classic worker: `new Worker('/engineWorker.js')`. Add `'/engineWorker.js': 'engineWorker.js'` to `STATIC_FILES` (`server.ts:11-15`); existing `.js` MIME is correct. In `engineWorker.ts` avoid worker-lib typings (tsconfig targets DOM): use `self.addEventListener('message', …)` with a narrow local cast for `postMessage`.

### Page layout — CSS grid, notebook theme preserved
Body becomes a 3-column grid; red-line background gradient on `body` unchanged:
```css
body { display: grid; grid-template-columns: 72px max-content 1fr; align-items: start; column-gap: 20px; padding: 40px 24px 56px 0; }
```
- Col 1 (~72px): empty margin left of the red line (gradient at 55–57px).
- Col 2: `<aside>` with only the existing `.titlebar` (logo + subtitle).
- Col 3: `<main>` stacking `#status`, `#tab-strip`, `.play-row`, `#stats-panel`, `#ascii-panel`.
- `.play-row { display: flex; gap: 18px; align-items: flex-start; }` — `#board-grid` left, `.controls` becomes a **vertical stack to the right of the board** (`flex-direction: column`). Reuse all existing button/select CSS; `#board-count` joins the select styling group; tab buttons reuse the button pattern with smaller padding; active tab gets the highlighter-yellow treatment.

### Tab strip & stats panel
- `#tab-strip` (ai-ai only): one button per session — `B1: hard×easy · 23` + status dot (thinking/restarting) via data-attributes.
- `#board-count` select (1/2/4/6/8, default 2), ai-ai only. Remove `#difficulty-p1`/`#difficulty-p2` (pairings now come from the rotation); `difficultyForPlayer` reads `session.p1/p2` in ai-ai.
- `#stats-panel`: 6-row table (ordered pairing, games, P1 wins, P2 wins, draws, P1 win %) from `aggregateResults(GET /api/results)`; refreshed on entering ai-ai and after each POST (no polling).

## File-by-File Changes

| File | Change |
|---|---|
| `src/ui/engineProtocol.ts` (new) | Request/response types |
| `src/ui/engineWorker.ts` (new) | ~25 lines: import `chooseMove`, handle message, post move/error |
| `src/ui/enginePool.ts` (new) | `EnginePool` (queue, pending map, cancelAll, terminate) |
| `src/ui/tournament.ts` (new) | `PAIRINGS`, `pairingAt`, `TOURNAMENT_TIME_BUDGET_MS`, `sessionTabLabel` |
| `src/shared/results.ts` (new) | `GameResult`, `isValidGameResult`, `aggregateResults` |
| `src/ui/tournament.spec.ts`, `src/shared/results.spec.ts` (new) | Unit tests (pure, no DOM/workers) |
| `package.json` | Two-bundle build script |
| `src/server/server.ts` | results file ensure + POST/GET `/api/results` with write chain; `STATIC_FILES` entry |
| `index.html` | Grid layout, `.play-row`, vertical controls, `#tab-strip`, `#board-count`, `#stats-panel`; remove per-player difficulty selects |
| `src/ui/app.ts` | Main refactor: `BoardSession[]`, pool-backed `runAiMove`, per-session loops, tabs, stats, results POST, mode gating for undo/persistence |

## Implementation Steps (each verifiable)

1. **Pure helpers + specs**: `src/shared/results.ts`, `src/ui/tournament.ts`, both spec files → `npm test` green.
2. **Server results API**: modify `server.ts` → verify with `npm start` + curl POST/GET `/api/results`; bad payload → 400; `results.json` grows.
3. ~~**Worker + pool + build**: new files, build script, `STATIC_FILES` → `npm run build` emits both bundles; `/engineWorker.js` served.~~ **Done** by `docs/superpowers/plans/2026-07-20-engine-worker-offload.md` (`src/ui/engineProtocol.ts`, `engineWorker.ts`, `enginePool.ts`, build script, `STATIC_FILES` entry — same names/wire protocol/build shape this plan specifies).
4. ~~**Route existing modes through the pool** (no other behavior change): size-1 pool at init; `runAiMove` awaits `pool.requestMove`; `cancelAll()` in `resetForMode` → all 3 modes still play; UI responsive during hard thinks.~~ **Done** by the same worker-offload plan.
   **Amendment**: `cancelAll()` there differs from this doc's original spec above (Architecture Decisions § Worker pool) — it does not just drop/orphan a busy worker's in-flight search, it **terminates and lazily respawns** the worker. Reason: expert difficulty here budgets up to 10s (vs. this doc's ≤1s tournament budgets), so an orphaned search left running in a size-1 pool would delay the next game's first move by up to 10s. When this plan grows the pool size, `cancelAll()`'s terminate+respawn behavior carries forward unchanged — it degrades gracefully to "drop nothing extra" when budgets are short, so no further change is needed here.
5. **Layout refactor** (`index.html` + minimal `app.ts` lookups) → visual check in all modes; margin left of red line empty; buttons right of board.
6. **Multi-board tournament in `app.ts`**: sessions, tabs, board-count, rotation, per-session loops (tournament budgets, zero delay), game-end → POST → restart, Pause-all, undo hidden, persistence skipped, pool resize on count change (bump generation).
7. **Stats panel**: fetch + aggregate + table render.
8. **Full pass**: `npm run typecheck && npm run lint && npm test` + manual verification.

## Verification

Jest:
- `tournament.spec.ts`: PAIRINGS is exactly the 6 agreed ordered pairs; `pairingAt` wraps across cycles; tab-label formatting.
- `results.spec.ts`: `aggregateResults` tallies ordered pairings separately (hard×medium ≠ medium×hard), handles draws, empty input → 6 zero rows; `isValidGameResult` accepts good / rejects bad records.

Manual (`npm start`, http://localhost:3000):
1. human-ai on hard: UI never freezes mid-think; state.json persists; reload restores undo/redo.
2. ai-ai, 4 boards: tabs appear; boards advance concurrently; tab switch redraws instantly; hidden tabs show live move counts.
3. Game finishes → auto-restart with next rotation pairing; `results.json` gains a correct record; stats table updates.
4. Pause halts all boards (≤1 in-flight move lands per board); Resume continues; New Game / count change / mode switch mid-think leaves no stray stones.
5. Back to human-ai: single board, undo/redo visible, persistence resumes.

## Risks

- Stale worker result after reset → dropped by pool pending-map + generation guard (never `applyMove` on a stale board — it throws).
- Concurrent result POSTs → server promise-chain lock.
- `PatternStore` UI cache is debug-only; deliberately not maintained for tournament sessions.
