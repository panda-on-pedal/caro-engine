# Release notes

## 1.2.5

### Fixes

- Reports panel: stall progress now shows `{stall}/{giveUp} · {pct}%` (or `{stall} · open` for never-give-up positions) instead of a dot row that grew unbounded once the give-up threshold was widened to 50 and unbounded in 1.2.4

## 1.2.4

### Engine

- New forced-move tier: a three whose own expansion sets up an unstoppable fork is answered by the lines shared by every fork route (catalog #21) — and no longer over-fires on positions that only look lost (catalog #22)
- Gapped fours now surface every valid block: the gap fill plus far-end boxes one step beyond the run (catalog #23), not just the single contiguous box
- **Book deepening**: background reinvest searches the real board frame (canonicalized only on persist), drops root jitter so a stored verdict is never decided by noise, and no longer floors back to the stale book move
- **Prepare-once root**: the narrowed root is computed once on the main thread and reused by the parallel fan-out and the experience gate instead of being recomputed in each worker
- Equal-depth move changes now supersede the stored book entry (downward score corrections are recorded); shallower results neither improve nor confirm, so they no longer burn a give-up life
- New "never give up" mode: `NEVER_GIVE_UP_SEARCHES` keeps every position open to reinvest forever

### Play & UI

- New "Never give up" setting (keep improving every position); the give-up threshold now ranges 1–50 (default 50) and is disabled while never-give-up is on
- Difficulty is persisted and restored on reload
- Stale book moves (no longer inside today's candidate root) are discarded instead of instant-replayed
- Vietnamese and English labels for the new setting

### Dev

- `search()` takes a single params object; `prepareRootMoves` result is passable via `preparedRoot`
- `Messages` type is inferred from `en.ts` instead of maintained by hand
- Catalog positions #21–#23 with narrowing snapshots

## 1.2.3

### Practice & experience

- **Prebuilt experience books**: on first launch (missing localStorage keys), seed each difficulty book in the background from GitHub raw `data/cache/{difficulty}.json` on the release tag matching `APP_VERSION` — not shipped in the npm package
- Opening lock fix: empty **and** single-stone positions share `EMPTY` and are never booked or instantly replayed (avoids one stored first reply locking every opening)

### Play & UI

- Vietnamese easy difficulty label: "Dễ xơi"

## 1.2.2

### Engine

- **PV follow**: engine remembers and replays the principal variation across successive "use"-mode requests, skipping full searches on known continuations (falls back to normal search on mismatch)

### Play & UI

- New thought narration for PV follow hits
- PV follow cell highlight shown mid-search

## 1.2.1

### Play & UI

- Version badge links to the matching GitHub release and shows when the app is up to date
- Favicon added
- Vietnamese difficulty labels improved

### Dev

- Compile-time `__DEBUG__` flag via Vite mode (guards logger and cell titles; `dev:ui` / `dev:ui:build` scripts)

## 1.2.0

### Engine

- **Parallel search** for expert mode: root candidates are partitioned across idle workers
- Synced iterative deepening: workers advance depth-by-depth together and keep the last fully completed depth when a slice hits the deadline
- Threat-block probe merges urgent defensive/offensive blocks into tactical root partitions before parallel fan-out
- Background reinvest search runs independently of the persist-experience flag

### Play & UI

- Component styles moved out of the shared stylesheet into scoped Svelte styles (`app.css` keeps only shared vars, reset, and the mount grid)

## 1.1.0

### Play & UI

- UI rebuilt with **Svelte** (nav rail, version badge, loading indicator, language selector)
- **Instructions** page covering rules, modes, and tips
- Show who plays X/O under the board (matchup)
- Narrate computer thinking mid-search (thought feed with optional cell highlight)
- Retry failed state/results API calls with user-visible notices
- Settings: show/hide engine thoughts; human vs computer narration toggle

### Practice & experience

- **Practice** mode: multi-board AI vs AI training without tournament scoring
- Disk-persisted **experience cache** so the engine reuses past search results
- Per-difficulty experience books, with canonical board orientation / symmetry matching
- Shared **human book**: AI can mimic winning human moves across all difficulties
- Practice opening moves and automatic restart when both sides leave known experience
- Practice improvement toggle: disable background re-search on cache hits for faster cache-edge exploration
- Graduated settle: entries freeze after N consecutive non-improving searches (configurable 1–9, default 3)
- Live **practice reports** panel (new / improved / stalled / settled per board)

### Engine

- Transposition table (Zobrist) with book deepening and per-orientation TT persistence
- Background reinvest on experience hits (full-budget search, preemptible by foreground play)
- Step time by own stones (early fights no longer burn the full budget on open twos)
- Settled / stall tracking so background search skips positions that no longer improve

## 1.0.0

First public release of **Caro Tournament** (`caro-tournament`) — Caro / Gomoku (five-in-a-row) on a 20×20 board, with a local engine and multi-board tournament mode.

### Play

- **You first** or **computer first** against a chosen difficulty
- **Tournament** mode: computer vs computer across all difficulty pairings
- Notebook-style board UI with last-move highlight and winning-line highlight
- English and Vietnamese UI
- Pause / resume tournament play, switch boards with tabs, and open a **Results** view

### Tournament

- Four strengths: **easy**, **medium**, **hard**, **expert**
- Ordered pairings (seat order matters — first player has the opening advantage)
- Several boards can run in parallel; board count scales with available CPU cores
- Results are saved and aggregated: wins, draws, and average moves per pairing and overall
- Visible pause on win/draw before the next game starts

### Engine

- Pattern-driven search with difficulty profiles (depth, time budget, fork awareness, variety)
- Threat / forced-line hunting on the strongest level
- Search runs off the main thread so the page stays responsive during long thinks
- Caro win rules including overlines (six or more) unless double-blocked

### Install & run

```bash
npm install -g caro-tournament
caro-tournament
# or
npx caro-tournament
```

- Default server: [http://localhost:2026](http://localhost:2026) (opens in the browser)
- Flags: `--port <number>`, `--no-open`
- Game data stored under `~/.caro-tournament/`

### Distribution & license

- Published on npm as [`caro-tournament`](https://www.npmjs.com/package/caro-tournament)
- Source: [github.com/panda-on-pedal/caro-engine](https://github.com/panda-on-pedal/caro-engine)
- Licensed under **AGPL-3.0** (share-alike; modified network services must offer corresponding source)
- Tag releases build assets, attest build provenance, create a GitHub draft release, and publish to npm via Trusted Publishing
