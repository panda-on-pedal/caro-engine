# Caro

Caro (Gomoku / five-in-a-row) on a 20×20 board, with a local engine you can play against or pit against itself.

Play against the computer, let the computer play first, or run a multi-board **Tournament** where every difficulty pairing races in parallel.

![Tournament mode — several computer vs computer boards running at once](README.assets/tournament-games.png)

## Quick start

```bash
npm install -g caro-tournament
caro-tournament
```

Or without a global install:

```bash
npx caro-tournament
```

This starts a local server at [http://localhost:2026](http://localhost:2026) and opens it in your browser. Game data is stored under `~/.caro-tournament/`.

Useful flags:

```bash
caro-tournament --port 3000   # use a different port
caro-tournament --no-open     # start server without opening the browser
```

## Tournament

Tournament mode matches the four difficulty levels against each other: **easy**, **medium**, **hard**, and **expert**.

- Seat order matters. Hard going first against medium is a different match from medium going first against hard, because the opening move is an advantage.
- You can run several boards at once so pairings play in parallel. The page stays responsive while games run.
- When games finish, results are saved. Open **Results** to see wins, draws, and average move counts for each pairing and overall.

Entering Tournament sets up the boards but waits: pick how many boards to run, then click **Start**. Click the board tabs to watch each game, or the **Results** tab for the standings.

## Practice

Practice mode looks like Tournament — computers play each other across parallel boards — but the goal is training, not standings.

- Every board writes to a shared **experience cache** on disk, so the engine gets stronger the more it plays.
- Results are **not** recorded; there is no Results tab.
- A game restarts automatically once both players leave known experience, so practice explores more openings.

As with Tournament, pick how many boards to run and click **Start**, then click the tabs to watch individual games.

## The engine

The engine is the computer opponent behind every computer-controlled seat. Strength is controlled by difficulty:

- **Easy**: Shallow look-ahead, quick replies, more variety in play
- **Medium**: Deeper search and recognition of common traps
- **Hard**: Longer thinking time and full awareness of fork patterns
- **Expert**: The strongest profile, with extra time and forced-line hunting

Higher levels think longer and see more of the board. Lower levels move faster and play with more unpredictability.

## Develop from source

### Requirements

- [Node.js](https://nodejs.org/) 18+ (developed on Node 24)
- npm (comes with Node)

### Install

```bash
npm install
```

### Build & start

```bash
npm start

# Custom port, no browser
npm start -- --port 3000 --no-open
```

This builds the app and starts the same local server (port 2026, opens the browser).

Useful scripts:

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm start`         | Production build and serve on port 2026         |
| `npm run dev`       | Dev build (debug on) and serve on port 2026     |
| `npm run build`     | Build UI (`dist/ui`) and CLI                    |
| `npm run dev:ui`    | Vite HMR for the UI (proxy `/api` to port 2026) |
| `npm test`          | Run tests                                       |
| `npm run typecheck` | TypeScript check                                |
| `npm run lint`      | Lint                                            |

Open the page, pick a mode (you first, computer first, or Tournament), choose difficulty or board count, and play - or watch the computers compete.

## Copyright and license

Copyright (C) 2026 Dang Nguyen \<haidang009@outlook.com\>

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License, version 3](LICENSE) only, as published by the Free Software Foundation.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details. You should have received a copy of the license along with this program; if not, see <https://www.gnu.org/licenses/>.

Every source file carries an [SPDX](https://spdx.dev/) header, and every built bundle in `dist/` carries the same notice as a preserved legal comment.

### What that means in practice

You may use, modify, and share this project. But if you distribute it, **or run a modified version as a network service**, AGPL-3.0 section 13 requires you to offer every user of that service the complete corresponding source of your version, under this same license, at no charge. Removing the copyright notices or the in-app source link does not lift that obligation — it is itself a violation of sections 4 and 5.

If those terms do not suit your use, a separate commercial license may be available; contact the author.

### Reporting a license violation

If you believe a site or product is using this code without complying, please open an issue or email the address above with the URL and what you observed.
