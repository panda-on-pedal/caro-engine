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
```

This builds the app and starts the same local server (port 2026, opens the browser).

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm start` | Build and serve on port 2026 |
| `npm run build` | Build only |
| `npm test` | Run tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | Lint |

Open the page, pick a mode (you first, computer first, or Tournament), choose difficulty or board count, and play - or watch the computers compete.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

You may use, modify, and share it, but if you distribute it or run a modified version as a network service, you must make the corresponding source available under the same license.
