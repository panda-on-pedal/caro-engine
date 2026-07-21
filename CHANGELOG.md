# Release notes

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
