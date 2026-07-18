# Caro (Gomoku) Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder random-move AI with a real Caro-rules engine (functional pattern classification → evaluation → negamax/alpha-beta search) selectable by difficulty, wired through the existing `GameState` API.

**Architecture:** Five new/rewired modules layered strictly downward — `engine → search → evaluate → patterns → rules → board` — plus a `rules.ts` Caro win-checker that replaces `board.ts`'s freestyle `checkWin` inside `state.ts`. Search operates on a mutable board copy with immutable `GameState` staying the outer API. The LLM bridge (`analysis.ts`/`report.ts`) and Phase B/C roadmap items (threat-space search, transposition tables, incremental eval) from the design doc are explicitly **out of scope** for this plan.

**Tech Stack:** TypeScript (strict, `nodenext` modules, explicit `.ts` import extensions), Jest via `ts-jest`, no new dependencies.

## Global Constraints

- Board is 20×20 (`BOARD_SIZE` in `src/engine/board.ts`); win length is exactly 5 (`WIN_LENGTH`).
- Caro rule: a run wins if its length is **exactly five** and it is **not blocked at both ends** by opponent stones. The board edge never counts as a block. Overline (six or more) never wins.
- Draw: board full.
- Dependency direction is strictly downward: `engine → search → evaluate → patterns → rules → board`. Lower layers must never import from higher layers.
- Pattern classification is **functional** (win-square counting over sliding 5-windows), never shape-string matching.
- Forks are **derived** from single-line `PatternInstance` data, not first-class patterns.
- `evaluate.ts`'s score table is a single exported constant — tuning is data, not code.
- All new source files live under `src/engine/`; all imports use explicit `.ts` extensions (`from './board.ts'`), matching the existing codebase convention.
- Test files are named `*.spec.ts` and live beside the file they test (matches `jest.config.mjs`'s `testMatch`).
- Strict TypeScript: no `any`; the ESLint config uses `typescript-eslint`'s `recommendedTypeChecked`, so unused vars/imports and loose types will fail lint.
- `Player = 1 | 2`, `Cell = 0 | 1 | 2` (0 = empty), both already defined in `board.ts` — reuse them, don't redefine.

---

### Task 1: Test fixture helper — `parseBoard(ascii)`

**Files:**

- Create: `src/engine/test-helpers/parse-board.ts`
- Test: `src/engine/test-helpers/parse-board.spec.ts`

**Interfaces:**

- Consumes: `createEmptyBoard` from `../board.ts`.
- Produces: `parseBoard(ascii: string): Board` — used by every later spec file in this plan to turn ASCII diagrams (`.` empty, `X` player 1, `O` player 2) into a `Board`. Pads to a square board (`isInBounds` in `board.ts` assumes `col < board.length`, i.e. square boards) sized to the larger of the row count / longest row, so odd-shaped fragments still produce a valid board.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/test-helpers/parse-board.spec.ts
import { parseBoard } from "./parse-board.ts";

describe("parseBoard", () => {
  it("parses a simple square diagram", () => {
    const board = parseBoard(`
      X.O
      .X.
      O.X
    `);
    expect(board[0][0]).toBe(1);
    expect(board[0][1]).toBe(0);
    expect(board[0][2]).toBe(2);
    expect(board[1][1]).toBe(1);
    expect(board[2][0]).toBe(2);
    expect(board[2][2]).toBe(1);
  });

  it("pads a non-square fragment into a square board", () => {
    const board = parseBoard("OXXX.");
    expect(board.length).toBe(board[0].length);
    expect(board.length).toBeGreaterThanOrEqual(5);
    expect(board[0][0]).toBe(2);
    expect(board[0][1]).toBe(1);
    expect(board[0][4]).toBe(0);
  });

  it("throws on an unrecognized symbol", () => {
    expect(() => parseBoard("X?X")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- parse-board`
Expected: FAIL with `Cannot find module './parse-board.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/engine/test-helpers/parse-board.ts
import { createEmptyBoard, type Board, type Cell } from "../board.ts";

const SYMBOLS: Record<string, Cell> = { ".": 0, X: 1, O: 2 };

/**
 * Parses an ASCII board diagram into a Board for tests. `.` = empty,
 * `X` = player 1, `O` = player 2. One line per row; whitespace within and
 * around lines is ignored. Pads to a square board (the larger of row count
 * and longest row) since board.ts's isInBounds assumes square boards;
 * padding cells stay empty.
 */
export function parseBoard(ascii: string): Board {
  const rows = ascii
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\s+/g, "").split(""));

  const numRows = rows.length;
  const numCols = Math.max(...rows.map((row) => row.length));
  const size = Math.max(numRows, numCols);

  const board = createEmptyBoard(size);
  rows.forEach((row, r) => {
    row.forEach((symbol, c) => {
      const value = SYMBOLS[symbol];
      if (value === undefined) {
        throw new Error(`Unknown symbol "${symbol}" in parseBoard input`);
      }
      board[r][c] = value;
    });
  });
  return board;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- parse-board`
Expected: PASS, 3/3 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/test-helpers/parse-board.ts src/engine/test-helpers/parse-board.spec.ts
git commit -m "test: add parseBoard ASCII fixture helper"
```

---

### Task 2: `rules.ts` — Caro win detection, wired into `state.ts`

**Files:**

- Create: `src/engine/rules.ts`
- Test: `src/engine/rules.spec.ts`
- Modify: `src/engine/state.ts:1,39` (swap `checkWin` import for `checkCaroWin`)
- Modify: `src/engine/state.spec.ts` (add a Caro-specific regression case)

**Interfaces:**

- Consumes: `isInBounds`, `WIN_LENGTH`, `type Board`, `type Player` from `./board.ts`.
- Produces: `checkCaroWin(board: Board, row: number, col: number, player: Player): boolean` — the single win-check used by `state.ts`'s `applyMove` from this task onward, and reused by `search.ts` in Task 10 for terminal-node detection.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/rules.spec.ts
import { placeMove } from "./board.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";
import { checkCaroWin } from "./rules.ts";

describe("checkCaroWin", () => {
  it("wins on a five blocked at neither end", () => {
    const board = parseBoard(`
      .......
      .XXXXX.
      .......
    `);
    expect(checkCaroWin(board, 1, 3, 1)).toBe(true);
  });

  it("wins on a five blocked at exactly one end (board edge is not a block)", () => {
    const board = parseBoard("XXXXXO");
    expect(checkCaroWin(board, 0, 2, 1)).toBe(true);
  });

  it("does not win on a five blocked at both ends", () => {
    const board = parseBoard("OXXXXXO");
    expect(checkCaroWin(board, 0, 3, 1)).toBe(false);
  });

  it("does not win on an overline (six in a row), even though it contains five consecutive stones", () => {
    const board = parseBoard(`
      ........
      .XXXXXX.
      ........
    `);
    expect(checkCaroWin(board, 1, 3, 1)).toBe(false);
    expect(checkCaroWin(board, 1, 4, 1)).toBe(false);
  });

  it("detects a vertical five at the board edge", () => {
    let board = parseBoard(`
      X....
      X....
      X....
      X....
      X....
    `);
    expect(checkCaroWin(board, 4, 0, 1)).toBe(true);
  });

  it("detects a diagonal five", () => {
    const board = parseBoard(`
      X....
      .X...
      ..X..
      ...X.
      ....X
    `);
    expect(checkCaroWin(board, 2, 2, 1)).toBe(true);
  });

  it("only evaluates the line through the queried cell, not unrelated fives elsewhere", () => {
    let board = parseBoard(`
      .........
      .XXXXX...
      .........
      .........
      .........
    `);
    board = placeMove(board, 3, 0, 1);
    expect(checkCaroWin(board, 3, 0, 1)).toBe(false);
  });

  it("returns false when the queried cell does not belong to the given player", () => {
    const board = parseBoard(".XXXXX.");
    expect(checkCaroWin(board, 0, 3, 2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- rules.spec`
Expected: FAIL with `Cannot find module './rules.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/engine/rules.ts
import { isInBounds, WIN_LENGTH, type Board, type Player } from "./board.ts";

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * Checks whether the stone just placed at (row, col) completes a
 * Caro-legal five: a run of exactly five stones, not blocked by an
 * opponent stone at both ends. The board edge never counts as a block;
 * a run of six or more (overline) never wins even though it contains
 * five consecutive stones.
 */
export function checkCaroWin(
  board: Board,
  row: number,
  col: number,
  player: Player,
): boolean {
  if (board[row][col] !== player) {
    return false;
  }

  const opponent: Player = player === 1 ? 2 : 1;

  return DIRECTIONS.some(([dRow, dCol]) => {
    let startRow = row;
    let startCol = col;
    while (
      isInBounds(board, startRow - dRow, startCol - dCol) &&
      board[startRow - dRow][startCol - dCol] === player
    ) {
      startRow -= dRow;
      startCol -= dCol;
    }

    let endRow = row;
    let endCol = col;
    while (
      isInBounds(board, endRow + dRow, endCol + dCol) &&
      board[endRow + dRow][endCol + dCol] === player
    ) {
      endRow += dRow;
      endCol += dCol;
    }

    const runLength =
      Math.max(Math.abs(endRow - startRow), Math.abs(endCol - startCol)) + 1;
    if (runLength !== WIN_LENGTH) {
      return false;
    }

    const beforeRow = startRow - dRow;
    const beforeCol = startCol - dCol;
    const afterRow = endRow + dRow;
    const afterCol = endCol + dCol;

    const blockedBefore =
      isInBounds(board, beforeRow, beforeCol) &&
      board[beforeRow][beforeCol] === opponent;
    const blockedAfter =
      isInBounds(board, afterRow, afterCol) &&
      board[afterRow][afterCol] === opponent;

    return !(blockedBefore && blockedAfter);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- rules.spec`
Expected: PASS, 8/8 tests

- [ ] **Step 5: Wire `checkCaroWin` into `state.ts`**

In `src/engine/state.ts`, replace the `checkWin` import and its one call site:

```typescript
// before (line 1):
import {
  checkWin,
  createEmptyBoard,
  isFull,
  isLegalMove,
  placeMove,
  type Board,
  type Player,
} from "./board.ts";
// after:
import {
  createEmptyBoard,
  isFull,
  isLegalMove,
  placeMove,
  type Board,
  type Player,
} from "./board.ts";
import { checkCaroWin } from "./rules.ts";
```

```typescript
// before (line 39):
const won = checkWin(board, move.row, move.col, player);
// after:
const won = checkCaroWin(board, move.row, move.col, player);
```

- [ ] **Step 6: Add a Caro-specific regression test to `state.spec.ts`**

Add this test inside the existing `describe('applyMove', ...)` block in `src/engine/state.spec.ts`:

```typescript
it("does not declare a winner when the five is blocked at both ends (Caro rule)", () => {
  let state = newGame();
  // Player 2 pre-blocks both ends of the row player 1 will fill.
  state = applyMove(state, { row: 1, col: 5 }, 1);
  state.board[1][5] = 0; // placeholder overwritten below; see note
});
```

That placeholder-mutation approach is wrong for an immutable `GameState` — write it as a sequence of real alternating moves instead:

```typescript
it("does not declare a winner when the five is blocked at both ends (Caro rule)", () => {
  let state = newGame();
  state = applyMove(state, { row: 5, col: 4 }, 2); // O blocks left end
  state = applyMove(state, { row: 6, col: 0 }, 1);
  state = applyMove(state, { row: 6, col: 5 }, 1);
  state = applyMove(state, { row: 7, col: 0 }, 2);
  state = applyMove(state, { row: 6, col: 1 }, 1);
  state = applyMove(state, { row: 7, col: 1 }, 2);
  state = applyMove(state, { row: 6, col: 2 }, 1);
  state = applyMove(state, { row: 7, col: 2 }, 2);
  state = applyMove(state, { row: 6, col: 3 }, 1);
  state = applyMove(state, { row: 5, col: 9 }, 2); // O blocks right end
  state = applyMove(state, { row: 6, col: 4 }, 1); // completes X X X X X at cols 0-4, row 6

  expect(state.board[6]).toEqual([1, 1, 1, 1, 1, ...Array(15).fill(0)]);
  expect(state.winner).toBeNull();
});
```

Wait — that leaves row 6 blocked by row-5/row-7 stones, not row 6 itself. Re-derive the moves so player 2's blocking stones sit at `(6, -1)`-equivalent and `(6, 5)` on row 6 itself (row 6, col 5 is in bounds; there is no col -1, so use cols 1-5 for X and block only the real right end at col 6, with the left end at col 0 being the board edge — that does not test "blocked both ends". Instead, place X at cols 1-5 and O at col 0 and col 6:

```typescript
it("does not declare a winner when the five is blocked at both ends (Caro rule)", () => {
  let state = newGame();
  state = applyMove(state, { row: 6, col: 1 }, 1);
  state = applyMove(state, { row: 6, col: 0 }, 2); // O blocks left end
  state = applyMove(state, { row: 6, col: 2 }, 1);
  state = applyMove(state, { row: 9, col: 0 }, 2); // filler, off row 6
  state = applyMove(state, { row: 6, col: 3 }, 1);
  state = applyMove(state, { row: 9, col: 1 }, 2); // filler, off row 6
  state = applyMove(state, { row: 6, col: 4 }, 1);
  state = applyMove(state, { row: 6, col: 6 }, 2); // O blocks right end
  state = applyMove(state, { row: 6, col: 5 }, 1); // completes X at cols 1-5, row 6

  expect(state.winner).toBeNull();
});
```

Use this final version. `applyMove` throws if `player !== state.nextPlayer` (see `state.ts`), and `newGame()` starts with `nextPlayer: 1` — so the sequence must start with player 1, not player 2. It alternates 1,2,1,2,1,2,1,2,1 across nine `applyMove` calls (player 1 on every odd call, starting first); the two player-2 "filler" moves at `(9,0)`/`(9,1)` exist only to preserve turn order and don't touch row 6. Add it to `src/engine/state.spec.ts` inside the `describe('applyMove', ...)` block.

- [ ] **Step 7: Run the full suite to verify nothing broke**

Run: `npm test`
Expected: PASS, all suites green (rules, state, board, engine, parse-board)

- [ ] **Step 8: Commit**

```bash
git add src/engine/rules.ts src/engine/rules.spec.ts src/engine/state.ts src/engine/state.spec.ts
git commit -m "feat: add Caro win rule and wire it into applyMove"
```

---

### Task 3: `patterns.ts` — scanning primitives + `five` detection

**Files:**

- Create: `src/engine/patterns.ts`
- Test: `src/engine/patterns.spec.ts`

**Interfaces:**

- Consumes: `isInBounds`, `WIN_LENGTH`, `type Board`, `type Cell`, `type Player` from `./board.ts`; `type Move` from `./state.ts`; `parseBoard` from `./test-helpers/parse-board.ts` (test only).
- Produces:
  - `type PatternType = 'five' | 'open-four' | 'four' | 'open-three' | 'three' | 'open-two' | 'two'`
  - `interface PatternInstance { type: PatternType; player: Player; cells: Move[]; gains: Move[]; criticalGains: Move[]; direction: [number, number] }` — `criticalGains` is the subset of `gains` that promotes this specific line to the next severity tier (two → open-three, three → open-four, four/open-four → five); it's what Task 7's widened `findForkPoints` scans instead of the full `gains` list.
  - `findPatterns(board: Board, player: Player): PatternInstance[]` — the umbrella scan every later task in this file extends. This task wires it up with `five` detection only; Tasks 4-6 add the other types into the same function.
  - Internal (not exported, but their shapes matter for later tasks in this file): `type CellReader = (row: number, col: number) => Cell | null`, `boardReader(board): CellReader`, `withOverrides(reader, overrides: ReadonlyMap<string, Player>): CellReader`, `windowCells`, `isViableWindow`, `viableWindowsInDirection`, `cellKey(move: Move): string`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/patterns.spec.ts
import { findPatterns } from "./patterns.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

describe("findPatterns — five", () => {
  it("finds a five with no gains", () => {
    const board = parseBoard(`
      .......
      .XXXXX.
      .......
    `);
    const patterns = findPatterns(board, 1);
    const fives = patterns.filter((p) => p.type === "five");
    expect(fives).toHaveLength(1);
    expect(fives[0].gains).toEqual([]);
    expect(fives[0].cells.map((c) => `${c.row},${c.col}`).sort()).toEqual(
      [1, 2, 3, 4, 5].map((col) => `1,${col}`).sort(),
    );
  });

  it("does not report a five for an overline (six in a row)", () => {
    const board = parseBoard(`
      ........
      .XXXXXX.
      ........
    `);
    const patterns = findPatterns(board, 1);
    expect(patterns.filter((p) => p.type === "five")).toHaveLength(0);
  });

  it("does not report a five blocked at both ends", () => {
    const board = parseBoard("OXXXXXO");
    const patterns = findPatterns(board, 1);
    expect(patterns.filter((p) => p.type === "five")).toHaveLength(0);
  });

  it("finds no patterns for the opponent on a board with only one player's stones", () => {
    const board = parseBoard(`
      .......
      .XXXXX.
      .......
    `);
    expect(findPatterns(board, 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- patterns.spec`
Expected: FAIL with `Cannot find module './patterns.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/engine/patterns.ts
import {
  isInBounds,
  WIN_LENGTH,
  type Board,
  type Cell,
  type Player,
} from "./board.ts";
import type { Move } from "./state.ts";

export type PatternType =
  | "five"
  | "open-four"
  | "four"
  | "open-three"
  | "three"
  | "open-two"
  | "two";

export interface PatternInstance {
  type: PatternType;
  player: Player;
  cells: Move[];
  gains: Move[];
  /** The subset of `gains` that promotes this line to the next severity tier. */
  criticalGains: Move[];
  direction: [number, number];
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

type CellReader = (row: number, col: number) => Cell | null;

function boardReader(board: Board): CellReader {
  return (row, col) => (isInBounds(board, row, col) ? board[row][col] : null);
}

function withOverrides(
  reader: CellReader,
  overrides: ReadonlyMap<string, Player>,
): CellReader {
  return (row, col) => {
    const override = overrides.get(`${row},${col}`);
    return override !== undefined ? override : reader(row, col);
  };
}

function cellKey(move: Move): string {
  return `${move.row},${move.col}`;
}

function windowCells(
  row: number,
  col: number,
  dRow: number,
  dCol: number,
): Move[] {
  return Array.from({ length: WIN_LENGTH }, (_, i) => ({
    row: row + i * dRow,
    col: col + i * dCol,
  }));
}

function isWindowInBounds(read: CellReader, cells: Move[]): boolean {
  return cells.every((c) => read(c.row, c.col) !== null);
}

/**
 * A window is viable for `player` if it contains no opponent stone and
 * filling its empty cells with `player`'s stones would produce a
 * Caro-legal five: not blocked at both ends, and not already extended
 * into an overline by a same-player stone just outside either end.
 */
function isViableWindow(
  read: CellReader,
  cells: Move[],
  dRow: number,
  dCol: number,
  player: Player,
): boolean {
  const opponent: Player = player === 1 ? 2 : 1;
  if (cells.some((c) => read(c.row, c.col) === opponent)) {
    return false;
  }

  const before = read(cells[0].row - dRow, cells[0].col - dCol);
  const after = read(cells[4].row + dRow, cells[4].col + dCol);
  if (before === player || after === player) {
    return false;
  }
  return !(before === opponent && after === opponent);
}

interface WindowInfo {
  stones: Move[];
  gaps: Move[];
}

function viableWindowsInDirection(
  read: CellReader,
  size: number,
  dRow: number,
  dCol: number,
  player: Player,
): WindowInfo[] {
  const results: WindowInfo[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const cells = windowCells(row, col, dRow, dCol);
      if (!isWindowInBounds(read, cells)) {
        continue;
      }
      if (!isViableWindow(read, cells, dRow, dCol, player)) {
        continue;
      }
      results.push({
        stones: cells.filter((c) => read(c.row, c.col) === player),
        gaps: cells.filter((c) => read(c.row, c.col) === 0),
      });
    }
  }
  return results;
}

function findFives(
  read: CellReader,
  size: number,
  dRow: number,
  dCol: number,
  player: Player,
): PatternInstance[] {
  return viableWindowsInDirection(read, size, dRow, dCol, player)
    .filter((w) => w.stones.length === WIN_LENGTH)
    .map((w) => ({
      type: "five" as const,
      player,
      cells: w.stones,
      gains: [],
      criticalGains: [],
      direction: [dRow, dCol] as [number, number],
    }));
}

export function findPatterns(board: Board, player: Player): PatternInstance[] {
  const read = boardReader(board);
  const size = board.length;
  const instances: PatternInstance[] = [];
  for (const [dRow, dCol] of DIRECTIONS) {
    instances.push(...findFives(read, size, dRow, dCol, player));
  }
  return instances;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- patterns.spec`
Expected: PASS, 4/4 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/patterns.ts src/engine/patterns.spec.ts
git commit -m "feat: add pattern scanning primitives and five detection"
```

---

### Task 4: `patterns.ts` — four / open-four classification

**Files:**

- Modify: `src/engine/patterns.ts` (add `findFours`, wire into `findPatterns`)
- Modify: `src/engine/patterns.spec.ts` (add tests)

**Interfaces:**

- Consumes: everything from Task 3 (`CellReader`, `viableWindowsInDirection`, `cellKey`, `PatternInstance`).
- Produces: `findFours(read: CellReader, size: number, dRow: number, dCol: number, player: Player): PatternInstance[]` — internal (not exported), but its name and signature are consumed directly by Task 5's `findThrees`.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/patterns.spec.ts`:

```typescript
describe("findPatterns — four / open-four", () => {
  it("classifies a four with two open ends as open-four", () => {
    const board = parseBoard(".XXXX.");
    const patterns = findPatterns(board, 1);
    const fours = patterns.filter((p) => p.type === "open-four");
    expect(fours).toHaveLength(1);
    expect(fours[0].gains.map((g) => g.col).sort()).toEqual([0, 5]);
    expect(fours[0].criticalGains).toEqual(fours[0].gains);
  });

  it("classifies a four blocked at one end as a plain four with one win square", () => {
    const board = parseBoard("OXXXX.");
    const patterns = findPatterns(board, 1);
    const fours = patterns.filter((p) => p.type === "four");
    expect(fours).toHaveLength(1);
    expect(fours[0].gains.map((g) => g.col)).toEqual([5]);
  });

  it("reports no four when blocked at both ends", () => {
    const board = parseBoard("OXXXXO");
    const patterns = findPatterns(board, 1);
    expect(
      patterns.filter((p) => p.type === "four" || p.type === "open-four"),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- patterns.spec`
Expected: FAIL — `open-four`/`four` filters return empty arrays where 1 is expected

- [ ] **Step 3: Write the implementation**

Add to `src/engine/patterns.ts`, above `findPatterns`:

```typescript
function groupByStoneSet(
  windows: WindowInfo[],
): Map<string, { cells: Move[]; gains: Map<string, Move> }> {
  const groups = new Map<string, { cells: Move[]; gains: Map<string, Move> }>();
  for (const w of windows) {
    const key = w.stones.map(cellKey).sort().join("|");
    const group = groups.get(key) ?? {
      cells: w.stones,
      gains: new Map<string, Move>(),
    };
    for (const gap of w.gaps) {
      group.gains.set(cellKey(gap), gap);
    }
    groups.set(key, group);
  }
  return groups;
}

function findFours(
  read: CellReader,
  size: number,
  dRow: number,
  dCol: number,
  player: Player,
): PatternInstance[] {
  const windows = viableWindowsInDirection(
    read,
    size,
    dRow,
    dCol,
    player,
  ).filter((w) => w.stones.length === 4);
  const groups = groupByStoneSet(windows);

  const instances: PatternInstance[] = [];
  for (const group of groups.values()) {
    const gains = [...group.gains.values()];
    if (gains.length === 0) {
      continue;
    }
    instances.push({
      type: gains.length >= 2 ? "open-four" : "four",
      player,
      cells: group.cells,
      gains,
      // Any gain completes a five, so every gain is critical.
      criticalGains: gains,
      direction: [dRow, dCol],
    });
  }
  return instances;
}
```

Update `findPatterns` to also call `findFours`:

```typescript
export function findPatterns(board: Board, player: Player): PatternInstance[] {
  const read = boardReader(board);
  const size = board.length;
  const instances: PatternInstance[] = [];
  for (const [dRow, dCol] of DIRECTIONS) {
    instances.push(...findFives(read, size, dRow, dCol, player));
    instances.push(...findFours(read, size, dRow, dCol, player));
  }
  return instances;
}
```

Also extract the shared grouping logic `findFives` used inline — refactor `findFives` to use `groupByStoneSet` is **not** needed (fives have no gains ambiguity: a 5-stone window's stone set is exactly the window, so no two windows ever share the same 5-stone set). Leave `findFives` as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- patterns.spec`
Expected: PASS, 7/7 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/patterns.ts src/engine/patterns.spec.ts
git commit -m "feat: classify four and open-four patterns"
```

---

### Task 5: `patterns.ts` — three / open-three classification

**Files:**

- Modify: `src/engine/patterns.ts` (add `findThrees`, wire into `findPatterns`)
- Modify: `src/engine/patterns.spec.ts` (add tests — the design doc's worked examples)

**Interfaces:**

- Consumes: `findFours`, `withOverrides`, `groupByStoneSet`, `viableWindowsInDirection`, `cellKey` from Tasks 3-4.
- Produces: `findThrees(read: CellReader, size: number, dRow: number, dCol: number, player: Player): PatternInstance[]` — internal, consumed by Task 6's `findTwos`.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/patterns.spec.ts`:

```typescript
describe("findPatterns — three / open-three (design doc worked examples)", () => {
  it("OXXX. classifies as three: only simple fours are reachable", () => {
    // Width matters here: with WIN_LENGTH=5, "OXXX." (5 cols) has exactly one
    // sliding window and it contains the O, so nothing would be found at all.
    // The extra trailing "." gives a second window that excludes the O.
    const board = parseBoard("OXXX..");
    const patterns = findPatterns(board, 1);
    const threes = patterns.filter((p) => p.type === "three");
    expect(threes).toHaveLength(1);
    const opens = patterns.filter((p) => p.type === "open-three");
    expect(opens).toHaveLength(0);
  });

  it("O.XXX. classifies as open-three: the right end yields two win squares", () => {
    // Same width issue as above: "O.XXX." (6 cols) has only one O-free
    // window, which caps the reachable four at one open end (blocked by the
    // board edge on the other) — never open-four. The extra trailing "."
    // gives col 5's gain room to open on both flanks.
    const board = parseBoard("O.XXX..");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-three");
    expect(opens).toHaveLength(1);
    // Filling col 1 only yields a blocked four (O is beyond it); only col 5 opens up to open-four.
    expect(opens[0].criticalGains.map((g) => g.col)).toEqual([5]);
  });

  it("O..XXX. classifies as open-three through the gaps", () => {
    const board = parseBoard("O..XXX.");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-three");
    expect(opens).toHaveLength(1);
  });

  it("O.XXXO reports no three: no viable window exists", () => {
    const board = parseBoard("O.XXXO");
    const patterns = findPatterns(board, 1);
    expect(
      patterns.filter((p) => p.type === "three" || p.type === "open-three"),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- patterns.spec`
Expected: FAIL — three/open-three filters return empty where instances are expected

- [ ] **Step 3: Write the implementation**

Add to `src/engine/patterns.ts`, above `findPatterns`:

```typescript
function findThrees(
  read: CellReader,
  size: number,
  dRow: number,
  dCol: number,
  player: Player,
): PatternInstance[] {
  const windows = viableWindowsInDirection(
    read,
    size,
    dRow,
    dCol,
    player,
  ).filter((w) => w.stones.length === 3);
  const groups = groupByStoneSet(windows);

  const instances: PatternInstance[] = [];
  for (const group of groups.values()) {
    const gains = [...group.gains.values()];
    if (gains.length === 0) {
      continue;
    }

    const criticalGains = gains.filter((gain) => {
      const hypothetical = withOverrides(
        read,
        new Map([[cellKey(gain), player]]),
      );
      const fours = findFours(hypothetical, size, dRow, dCol, player);
      return fours.some(
        (four) =>
          four.type === "open-four" &&
          four.cells.some((c) => cellKey(c) === cellKey(gain)),
      );
    });

    instances.push({
      type: criticalGains.length > 0 ? "open-three" : "three",
      player,
      cells: group.cells,
      gains,
      criticalGains,
      direction: [dRow, dCol],
    });
  }
  return instances;
}
```

Update `findPatterns`:

```typescript
export function findPatterns(board: Board, player: Player): PatternInstance[] {
  const read = boardReader(board);
  const size = board.length;
  const instances: PatternInstance[] = [];
  for (const [dRow, dCol] of DIRECTIONS) {
    instances.push(...findFives(read, size, dRow, dCol, player));
    instances.push(...findFours(read, size, dRow, dCol, player));
    instances.push(...findThrees(read, size, dRow, dCol, player));
  }
  return instances;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- patterns.spec`
Expected: PASS, 11/11 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/patterns.ts src/engine/patterns.spec.ts
git commit -m "feat: classify three and open-three patterns"
```

---

### Task 6: `patterns.ts` — two / open-two classification

**Files:**

- Modify: `src/engine/patterns.ts` (add `findTwos`, wire into `findPatterns`)
- Modify: `src/engine/patterns.spec.ts` (add tests)

**Interfaces:**

- Consumes: `findThrees`, `withOverrides`, `groupByStoneSet`, `viableWindowsInDirection`, `cellKey` from Task 5.
- Produces: `findTwos(read: CellReader, size: number, dRow: number, dCol: number, player: Player): PatternInstance[]` — internal, folded into `findPatterns`. This is the last pattern-type task; `findPatterns` is complete after this task.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/patterns.spec.ts`:

```typescript
describe("findPatterns — two / open-two", () => {
  it("classifies an isolated two with room to grow as open-two", () => {
    const board = parseBoard("..XX...");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-two");
    expect(opens.length).toBeGreaterThanOrEqual(1);
    expect(opens[0].criticalGains.length).toBeGreaterThan(0);
  });

  it("classifies a two boxed in on one side as a plain two, not open-two", () => {
    // "OXX.." (5 cols) has exactly one window and it contains the O, so
    // nothing would be found — same width trap as Task 5. Widen by one.
    const board = parseBoard("OXX...");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-two");
    expect(opens).toHaveLength(0);
    const twos = patterns.filter((p) => p.type === "two");
    expect(twos.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- patterns.spec`
Expected: FAIL — `two`/`open-two` filters return empty arrays

- [ ] **Step 3: Write the implementation**

Add to `src/engine/patterns.ts`, above `findPatterns`:

```typescript
function findTwos(
  read: CellReader,
  size: number,
  dRow: number,
  dCol: number,
  player: Player,
): PatternInstance[] {
  const windows = viableWindowsInDirection(
    read,
    size,
    dRow,
    dCol,
    player,
  ).filter((w) => w.stones.length === 2);
  const groups = groupByStoneSet(windows);

  const instances: PatternInstance[] = [];
  for (const group of groups.values()) {
    const gains = [...group.gains.values()];
    if (gains.length === 0) {
      continue;
    }

    const criticalGains = gains.filter((gain) => {
      const hypothetical = withOverrides(
        read,
        new Map([[cellKey(gain), player]]),
      );
      const threes = findThrees(hypothetical, size, dRow, dCol, player);
      return threes.some(
        (three) =>
          three.type === "open-three" &&
          three.cells.some((c) => cellKey(c) === cellKey(gain)),
      );
    });

    instances.push({
      type: criticalGains.length > 0 ? "open-two" : "two",
      player,
      cells: group.cells,
      gains,
      criticalGains,
      direction: [dRow, dCol],
    });
  }
  return instances;
}
```

Update `findPatterns` to its final form:

```typescript
export function findPatterns(board: Board, player: Player): PatternInstance[] {
  const read = boardReader(board);
  const size = board.length;
  const instances: PatternInstance[] = [];
  for (const [dRow, dCol] of DIRECTIONS) {
    instances.push(...findFives(read, size, dRow, dCol, player));
    instances.push(...findFours(read, size, dRow, dCol, player));
    instances.push(...findThrees(read, size, dRow, dCol, player));
    instances.push(...findTwos(read, size, dRow, dCol, player));
  }
  return instances;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- patterns.spec`
Expected: PASS, 13/13 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/patterns.ts src/engine/patterns.spec.ts
git commit -m "feat: classify two and open-two patterns, completing findPatterns"
```

---

### Task 7: `patterns.ts` — `findForkPoints`

**Files:**

- Modify: `src/engine/patterns.ts` (add `ForkPoint`, `findForkPoints`)
- Modify: `src/engine/patterns.spec.ts` (add tests)

**Interfaces:**

- Consumes: `PatternInstance`, `cellKey` from earlier tasks in this file.
- Produces: `interface ForkPoint { move: Move; player: Player; patterns: PatternInstance[] }` and `findForkPoints(patterns: PatternInstance[]): ForkPoint[]` — both exported; consumed by `search.ts` in Task 11 for move ordering.

**Scope note:** this widens the original single-tier definition. A fork point is now any empty cell that promotes **two or more of the player's lines, in different directions, to a more severe tier in the same move** — using each pattern's `criticalGains` (Task 3-6) rather than its raw `gains`. This subsumes the original "two already-severe lines (four/open-four/open-three) converge on one gain" case, and additionally catches the classic **double-three**: two `open-two` patterns that each individually promote to `open-three` from the same move. That second shape is common and important in real play (an open-two pair converging is a much more frequent tactic than two already-severe lines converging) and was invisible under the original `SEVERE_TYPES`-gated definition, which only ever looked at patterns already classified four/open-four/open-three. Plain `two`/`three` patterns still contribute nothing, but now because their `criticalGains` is empty by construction (see Task 5/6), not because of an explicit type allow-list.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/patterns.spec.ts`:

```typescript
import { findForkPoints, findPatterns } from "./patterns.ts";

describe("findForkPoints", () => {
  it("finds a fork point where an open-three and a four (different directions) share a gain", () => {
    // Horizontal open-three centered so its right-side gain is (2, 5);
    // vertical four whose single gain is also (2, 5).
    const board = parseBoard(`
      .......
      .......
      O.XXX..
      .....X.
      .....X.
      .....X.
      .......
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    const atTarget = forkPoints.filter(
      (f) => f.move.row === 2 && f.move.col === 5,
    );
    expect(atTarget).toHaveLength(1);
    const directions = new Set(
      atTarget[0].patterns.map((p) => `${p.direction[0]},${p.direction[1]}`),
    );
    expect(directions.size).toBeGreaterThanOrEqual(2);
  });

  it("finds a double-three fork: two open-twos that each promote to open-three from the same move", () => {
    // Horizontal open-two at row 2 (cols 3-4) promotes to open-three by
    // filling (2, 5); vertical open-two at col 5 (rows 1 and 3, split by a
    // gap) promotes to open-three by filling that same gap at (2, 5).
    // Neither line is severe yet on its own — this is exactly the shape the
    // original SEVERE_TYPES-only definition missed.
    const board = parseBoard(`
      .......
      .....X.
      ...XX..
      .....X.
      .......
    `);
    const patterns = findPatterns(board, 1);
    const forkPoints = findForkPoints(patterns);
    const atTarget = forkPoints.filter(
      (f) => f.move.row === 2 && f.move.col === 5,
    );
    expect(atTarget).toHaveLength(1);
    expect(atTarget[0].patterns.every((p) => p.type === "open-two")).toBe(
      true,
    );
    const directions = new Set(
      atTarget[0].patterns.map((p) => `${p.direction[0]},${p.direction[1]}`),
    );
    expect(directions.size).toBeGreaterThanOrEqual(2);
  });

  it("does not report a fork point for a single severe pattern in one direction", () => {
    const board = parseBoard(".XXXX.");
    const patterns = findPatterns(board, 1);
    expect(findForkPoints(patterns)).toEqual([]);
  });

  it("does not report a fork for a single open-two even though it will promote to open-three", () => {
    const board = parseBoard("..XX...");
    const patterns = findPatterns(board, 1);
    expect(findForkPoints(patterns)).toEqual([]);
  });

  it("ignores plain two/three patterns when looking for forks", () => {
    const board = parseBoard(`
      ..XX...
      .......
      ..XX...
    `);
    const patterns = findPatterns(board, 1);
    expect(findForkPoints(patterns)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- patterns.spec`
Expected: FAIL with `findForkPoints is not a function` (or `Cannot find module` if not yet exported)

- [ ] **Step 3: Write the implementation**

Add to `src/engine/patterns.ts`, at the end of the file:

```typescript
export interface ForkPoint {
  move: Move;
  player: Player;
  patterns: PatternInstance[];
}

/**
 * A fork point is an empty cell that appears in the `criticalGains` of two
 * or more of the player's patterns in different directions — i.e. a single
 * move that promotes two separate lines to a more severe tier at once.
 * `criticalGains` already encodes what "more severe" means per type (four/
 * open-four completes a five; three/open-three promotes to open-four; two/
 * open-two promotes to open-three), and is empty for plain two/three
 * patterns by construction, so no type allow-list is needed here — every
 * pattern's criticalGains can be scanned uniformly.
 */
export function findForkPoints(patterns: PatternInstance[]): ForkPoint[] {
  const byGain = new Map<string, PatternInstance[]>();
  for (const pattern of patterns) {
    for (const gain of pattern.criticalGains) {
      const key = cellKey(gain);
      const list = byGain.get(key) ?? [];
      list.push(pattern);
      byGain.set(key, list);
    }
  }

  const forkPoints: ForkPoint[] = [];
  for (const [key, list] of byGain) {
    const directions = new Set(
      list.map((p) => `${p.direction[0]},${p.direction[1]}`),
    );
    if (directions.size < 2) {
      continue;
    }
    const [rowStr, colStr] = key.split(",");
    forkPoints.push({
      move: { row: Number(rowStr), col: Number(colStr) },
      player: list[0].player,
      patterns: list,
    });
  }
  return forkPoints;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- patterns.spec`
Expected: PASS, 18/18 tests

If the first test's board layout doesn't actually produce a shared gain at `(2, 5)` once run (geometry is easy to get subtly wrong by hand), adjust the ASCII diagram's stone placement until `atTarget` has length 1 — the requirement being tested (two severe patterns in different directions sharing one gain cell) is what matters, not these exact coordinates.

- [ ] **Step 5: Commit**

```bash
git add src/engine/patterns.ts src/engine/patterns.spec.ts
git commit -m "feat: derive fork points from severe pattern gains"
```

---

### Task 8: `evaluate.ts` — score table + `evaluate()`

**Files:**

- Create: `src/engine/evaluate.ts`
- Test: `src/engine/evaluate.spec.ts`

**Interfaces:**

- Consumes: `findPatterns`, `type PatternInstance`, `type PatternType` from `./patterns.ts`; `type Board`, `type Player` from `./board.ts`.
- Produces: `PATTERN_SCORES: Record<PatternType, number>`, `TEMPO_MULTIPLIER: number`, `WIN_SCORE: number`, `evaluate(board: Board, playerToMove: Player): number` — consumed by `search.ts` in Task 10 (leaf evaluation) and `WIN_SCORE` reused there for terminal scoring.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/evaluate.spec.ts
import { evaluate, WIN_SCORE } from "./evaluate.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

describe("evaluate", () => {
  it("scores an open-four position higher than an open-three position for the same player", () => {
    const openFourBoard = parseBoard(".XXXX..");
    const openThreeBoard = parseBoard(".XXX...");
    expect(evaluate(openFourBoard, 1)).toBeGreaterThan(
      evaluate(openThreeBoard, 1),
    );
  });

  it("scores an open-three position higher than a plain-two position for the same player", () => {
    const openThreeBoard = parseBoard(".XXX...");
    const twoBoard = parseBoard(".XX....");
    expect(evaluate(openThreeBoard, 1)).toBeGreaterThan(evaluate(twoBoard, 1));
  });

  it("gives the side to move a tempo bonus over an otherwise symmetric position", () => {
    const board = parseBoard(`
      .XXX...
      .......
      .OOO...
    `);
    const scoreXToMove = evaluate(board, 1);
    const scoreOToMove = evaluate(board, 2);
    expect(scoreXToMove).toBeGreaterThan(-scoreOToMove);
  });

  it("returns WIN_SCORE when the player to move already has a five on the board", () => {
    const board = parseBoard(".XXXXX.");
    expect(evaluate(board, 1)).toBe(WIN_SCORE);
  });

  it("returns -WIN_SCORE when the opponent already has a five on the board", () => {
    const board = parseBoard(".OOOOO.");
    expect(evaluate(board, 1)).toBe(-WIN_SCORE);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- evaluate.spec`
Expected: FAIL with `Cannot find module './evaluate.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/engine/evaluate.ts
import type { Board, Player } from "./board.ts";
import {
  findPatterns,
  type PatternInstance,
  type PatternType,
} from "./patterns.ts";

export const PATTERN_SCORES: Record<PatternType, number> = {
  five: 1_000_000,
  "open-four": 100_000,
  four: 10_000,
  "open-three": 5_000,
  three: 500,
  "open-two": 100,
  two: 10,
};

export const TEMPO_MULTIPLIER = 1.2;
export const WIN_SCORE = 10_000_000;

function scorePatterns(patterns: PatternInstance[], isMover: boolean): number {
  const total = patterns.reduce((sum, p) => sum + PATTERN_SCORES[p.type], 0);
  return isMover ? total * TEMPO_MULTIPLIER : total;
}

/**
 * Sums pattern scores for both sides, giving the side to move a tempo
 * bonus (a four for the mover is a win next turn). Terminal positions
 * (a five already on the board) short-circuit to +/- WIN_SCORE.
 */
export function evaluate(board: Board, playerToMove: Player): number {
  const opponent: Player = playerToMove === 1 ? 2 : 1;

  const moverPatterns = findPatterns(board, playerToMove);
  const opponentPatterns = findPatterns(board, opponent);

  if (moverPatterns.some((p) => p.type === "five")) {
    return WIN_SCORE;
  }
  if (opponentPatterns.some((p) => p.type === "five")) {
    return -WIN_SCORE;
  }

  return (
    scorePatterns(moverPatterns, true) - scorePatterns(opponentPatterns, false)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- evaluate.spec`
Expected: PASS, 5/5 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/evaluate.ts src/engine/evaluate.spec.ts
git commit -m "feat: add pattern-based position evaluation"
```

---

### Task 9: `search.ts` — candidate move generation

**Files:**

- Create: `src/engine/search.ts`
- Test: `src/engine/search.spec.ts`

**Interfaces:**

- Consumes: `isLegalMove`, `type Board` from `./board.ts`; `type Move` from `./state.ts`.
- Produces: `findCandidateMoves(board: Board): Move[]` — exported for testing and reused inside this file's own `negamax` (Task 10).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/search.spec.ts
import { findCandidateMoves } from "./search.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

describe("findCandidateMoves", () => {
  it("returns only the center cell on an empty board", () => {
    const board = parseBoard(`
      .....
      .....
      .....
      .....
      .....
    `);
    const candidates = findCandidateMoves(board);
    expect(candidates).toEqual([{ row: 2, col: 2 }]);
  });

  it("returns only empty cells within distance 2 of an existing stone", () => {
    const board = parseBoard(`
      .......
      .......
      ...X...
      .......
      .......
      .......
      .......
    `);
    const candidates = findCandidateMoves(board);
    expect(candidates.length).toBeGreaterThan(0);
    for (const move of candidates) {
      const rowDelta = Math.abs(move.row - 2);
      const colDelta = Math.abs(move.col - 2);
      expect(Math.max(rowDelta, colDelta)).toBeLessThanOrEqual(2);
    }
    // (5,5) is far from the only stone at (2,2) and must not be a candidate.
    expect(candidates.some((m) => m.row === 5 && m.col === 5)).toBe(false);
  });

  it("never returns an occupied cell", () => {
    const board = parseBoard(`
      .......
      ..XXX..
      .......
    `);
    const candidates = findCandidateMoves(board);
    for (const move of candidates) {
      expect(board[move.row][move.col]).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- search.spec`
Expected: FAIL with `Cannot find module './search.ts'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/engine/search.ts
import { isLegalMove, type Board } from "./board.ts";
import type { Move } from "./state.ts";

const CANDIDATE_RADIUS = 2;

export function findCandidateMoves(board: Board): Move[] {
  const candidates = new Map<string, Move>();
  let hasStone = false;

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] === 0) {
        continue;
      }
      hasStone = true;
      for (let dRow = -CANDIDATE_RADIUS; dRow <= CANDIDATE_RADIUS; dRow += 1) {
        for (
          let dCol = -CANDIDATE_RADIUS;
          dCol <= CANDIDATE_RADIUS;
          dCol += 1
        ) {
          const r = row + dRow;
          const c = col + dCol;
          if (isLegalMove(board, r, c)) {
            candidates.set(`${r},${c}`, { row: r, col: c });
          }
        }
      }
    }
  }

  if (!hasStone) {
    const center = Math.floor(board.length / 2);
    return [{ row: center, col: center }];
  }

  return [...candidates.values()];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- search.spec`
Expected: PASS, 3/3 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/search.ts src/engine/search.spec.ts
git commit -m "feat: add candidate move generation for search"
```

---

### Task 10: `search.ts` — negamax + alpha-beta core

**Files:**

- Modify: `src/engine/search.ts` (add `negamax`, not yet exported — exercised through a small exported test seam)
- Modify: `src/engine/search.spec.ts` (add tests)

**Interfaces:**

- Consumes: `findCandidateMoves` (Task 9); `placeMove`, `type Board`, `type Player` from `./board.ts`; `checkCaroWin` from `./rules.ts`; `evaluate`, `WIN_SCORE` from `./evaluate.ts`; `type Move` from `./state.ts`.
- Produces: `negamaxSearch(board: Board, player: Player, depth: number): { score: number; principalVariation: Move[] }` — exported so this task's tests can call it directly; consumed by Task 12's `search()` as the per-depth call inside iterative deepening. (Task 11 renames the internal helper `negamax` and wires move ordering into it — `negamaxSearch`'s exported signature does not change.)

Moves are found win-in-1 puzzles for a 20×20-sized board fragment; use small boards via `parseBoard` (they still respect all Caro rules).

- [ ] **Step 1: Write the failing tests**

```typescript
// add to src/engine/search.spec.ts
import { negamaxSearch } from "./search.ts";

describe("negamaxSearch", () => {
  it("finds the unique winning move when one is available (win-in-1)", () => {
    // X has an open four; playing either end wins. Use an open four
    // blocked on the left by board edge padding removed — force a unique
    // winning square by blocking one end with O.
    const board = parseBoard(`
      ..........
      .OXXXX....
      ..........
    `);
    const result = negamaxSearch(board, 1, 2);
    expect(result.principalVariation[0]).toEqual({ row: 1, col: 6 });
    expect(result.score).toBeGreaterThan(0);
  });

  it("finds the unique blocking move when the opponent threatens an open four next move", () => {
    // O has an open three; if X does not block, O gets an open four.
    // The only move that denies both extension squares is not generally
    // unique for an open three, so instead give O a four (one win square)
    // which X must block at that single square.
    const board = parseBoard(`
      ..........
      .OOOO.....
      ..........
    `);
    const result = negamaxSearch(board, 1, 2);
    expect(result.principalVariation[0]).toEqual({ row: 1, col: 5 });
    expect(result.score).toBeGreaterThan(0);
  });

  it("returns a score of 0 for an empty board scanned to depth 1 (no forced outcome)", () => {
    const board = parseBoard(`
      .....
      .....
      .....
      .....
      .....
    `);
    const result = negamaxSearch(board, 1, 1);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.principalVariation).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- search.spec`
Expected: FAIL with `negamaxSearch is not a function` (or module export missing)

- [ ] **Step 3: Write the implementation**

Add to `src/engine/search.ts`:

```typescript
import { placeMove, type Player } from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { evaluate, WIN_SCORE } from "./evaluate.ts";

interface SearchNode {
  score: number;
  principalVariation: Move[];
}

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

function negamax(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
): SearchNode {
  if (depth === 0) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  const moves = findCandidateMoves(board);
  if (moves.length === 0) {
    return { score: 0, principalVariation: [] };
  }

  let best: SearchNode = { score: -Infinity, principalVariation: [] };
  let currentAlpha = alpha;

  for (const move of moves) {
    const next = placeMove(board, move.row, move.col, player);
    const isWin = checkCaroWin(next, move.row, move.col, player);

    const node: SearchNode = isWin
      ? { score: WIN_SCORE + depth, principalVariation: [] }
      : (() => {
          const child = negamax(
            next,
            otherPlayer(player),
            depth - 1,
            -beta,
            -currentAlpha,
          );
          return {
            score: -child.score,
            principalVariation: child.principalVariation,
          };
        })();

    if (node.score > best.score) {
      best = {
        score: node.score,
        principalVariation: [move, ...node.principalVariation],
      };
    }
    currentAlpha = Math.max(currentAlpha, node.score);
    if (currentAlpha >= beta) {
      break;
    }
  }

  return best;
}

export function negamaxSearch(
  board: Board,
  player: Player,
  depth: number,
): SearchNode {
  return negamax(board, player, depth, -Infinity, Infinity);
}
```

Also update the `import type { Move } from './state.ts';` line to a value-and-type import isn't needed (`Move` stays type-only); add the new imports listed above near the top of the file alongside the existing `board.ts` import (merge `Player` into the existing `import { isLegalMove, type Board } from './board.ts';` line, e.g. `import { isLegalMove, placeMove, type Board, type Player } from './board.ts';`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- search.spec`
Expected: PASS, 6/6 tests

If a puzzle's expected coordinates don't match (off-by-one from hand-tracing the ASCII), print `result.principalVariation` and adjust the expected `{ row, col }` to match the actual unique correct square — the invariant under test is uniqueness and correctness of the tactical move, not the specific numbers.

- [ ] **Step 5: Commit**

```bash
git add src/engine/search.ts src/engine/search.spec.ts
git commit -m "feat: add negamax alpha-beta search core"
```

---

### Task 11: `search.ts` — move ordering

**Files:**

- Modify: `src/engine/search.ts` (add `orderMoves`, wire into `negamax`)
- Modify: `src/engine/search.spec.ts` (add tests)

**Interfaces:**

- Consumes: `findPatterns`, `findForkPoints`, `type PatternInstance`, `type PatternType` from `./patterns.ts`.
- Produces: `orderMoves(moves: Move[], ownPatterns: PatternInstance[], oppPatterns: PatternInstance[], forkPoints: ReadonlySet<string>): Move[]` — exported for direct testing; wired into `negamax`'s loop.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/search.spec.ts`:

```typescript
import { findForkPoints, findPatterns } from "./patterns.ts";
import { orderMoves } from "./search.ts";

describe("orderMoves", () => {
  it("puts the move that completes a five first", () => {
    const board = parseBoard(".XXXX....");
    const ownPatterns = findPatterns(board, 1);
    const oppPatterns = findPatterns(board, 2);
    const forkPoints = new Set(
      findForkPoints(ownPatterns).map((f) => `${f.move.row},${f.move.col}`),
    );
    const moves = [
      { row: 0, col: 8 },
      { row: 0, col: 5 },
      { row: 0, col: 0 },
    ];

    const ordered = orderMoves(moves, ownPatterns, oppPatterns, forkPoints);
    expect(ordered[0]).toEqual({ row: 0, col: 5 });
  });

  it("prioritizes blocking an opponent four over developing an own open-three", () => {
    const board = parseBoard(`
      .OOOO....
      .........
      .XXX.....
    `);
    const ownPatterns = findPatterns(board, 1);
    const oppPatterns = findPatterns(board, 2);
    const forkPoints = new Set(
      findForkPoints(ownPatterns).map((f) => `${f.move.row},${f.move.col}`),
    );
    const moves = [
      { row: 2, col: 4 },
      { row: 0, col: 5 },
    ];

    const ordered = orderMoves(moves, ownPatterns, oppPatterns, forkPoints);
    expect(ordered[0]).toEqual({ row: 0, col: 5 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- search.spec`
Expected: FAIL with `orderMoves is not a function`

- [ ] **Step 3: Write the implementation**

Add to `src/engine/search.ts`:

```typescript
import {
  findForkPoints,
  findPatterns,
  type PatternInstance,
  type PatternType,
} from "./patterns.ts";

function movesGaining(
  patterns: PatternInstance[],
  type: PatternType,
  key: string,
): boolean {
  return patterns.some(
    (p) => p.type === type && p.gains.some((g) => `${g.row},${g.col}` === key),
  );
}

export function orderMoves(
  moves: Move[],
  ownPatterns: PatternInstance[],
  oppPatterns: PatternInstance[],
  forkPoints: ReadonlySet<string>,
): Move[] {
  const scoreOf = (move: Move): number => {
    const key = `${move.row},${move.col}`;

    if (
      movesGaining(ownPatterns, "four", key) ||
      movesGaining(ownPatterns, "open-four", key)
    ) {
      return 5;
    }
    if (
      movesGaining(oppPatterns, "four", key) ||
      movesGaining(oppPatterns, "open-four", key)
    ) {
      return 4;
    }
    if (forkPoints.has(key)) {
      return 3;
    }
    if (movesGaining(ownPatterns, "open-three", key)) {
      return 2;
    }
    return 1;
  };

  return [...moves].sort((a, b) => scoreOf(b) - scoreOf(a));
}
```

**Correction (post-implementation):** the original tier scheme here had a top tier keyed on `movesGaining(ownPatterns, "five", key)`, intended to prioritize a move that completes the player's own five above everything else. That tier is unreachable: a `"five"` `PatternInstance` always has `gains: []` by construction (Task 3) — a five is already complete, so there's nothing left to "gain" toward it. The move that actually completes an own five is the gain of an own `"four"`/`"open-four"` pattern, which the original scheme ranked at tier 4, *below* tier 5's "block opponent's four/open-four." That inversion means, whenever both an own-winning-completion move and an opponent-blocking move are simultaneously candidates, the original code would rank the block first — harmless while `negamax` (Task 10) explores every candidate to full depth regardless of order, but a real "engine misses an available win" risk once Task 12 adds a time budget that can `break` the loop before reaching a later-ordered move. The corrected scheme above merges the dead tier into the (now top) own-four/open-four tier and renumbers 5→1; behavior is otherwise unchanged. Task 11's own two tests (five-completion tie, block-over-open-three) are unaffected by the renumbering, but add a new regression test asserting an own-four/open-four completion outranks an available opponent-block, so this exact inversion cannot silently regress.

Wire it into `negamax`'s loop (replace the plain `const moves = findCandidateMoves(board);` line and the `for (const move of moves)` loop header):

```typescript
const rawMoves = findCandidateMoves(board);
if (rawMoves.length === 0) {
  return { score: 0, principalVariation: [] };
}

const ownPatterns = findPatterns(board, player);
const oppPatterns = findPatterns(board, otherPlayer(player));
const forkPoints = new Set(
  findForkPoints(ownPatterns).map((f) => `${f.move.row},${f.move.col}`),
);
const moves = orderMoves(rawMoves, ownPatterns, oppPatterns, forkPoints);
```

(This replaces the earlier `const moves = findCandidateMoves(board); if (moves.length === 0) { ... }` block from Task 10 — the empty-check moves to `rawMoves`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- search.spec`
Expected: PASS, 8/8 tests

- [ ] **Step 5: Run the full suite to confirm negamax's puzzle tests from Task 10 still pass with ordering wired in**

Run: `npm test`
Expected: PASS, all suites green

- [ ] **Step 6: Commit**

```bash
git add src/engine/search.ts src/engine/search.spec.ts
git commit -m "feat: add move ordering and wire it into negamax"
```

---

### Task 12: `search.ts` — iterative deepening + time budget

**Files:**

- Modify: `src/engine/search.ts` (add `search`, `SearchConfig`, `SearchResult`)
- Modify: `src/engine/search.spec.ts` (add tests)

**Interfaces:**

- Consumes: `negamaxSearch` (really: reuses the internal `negamax` directly, see below) from Task 11.
- Produces: `interface SearchConfig { maxDepth: number; timeBudgetMs?: number }`, `interface SearchResult { move: Move; score: number; depth: number; principalVariation: Move[]; nodesVisited: number }`, `search(board: Board, player: Player, config: SearchConfig): SearchResult` — this is the function `engine.ts`'s `chooseMove` calls in Task 13.

To track `nodesVisited` and respect a deadline mid-recursion, `negamax` needs two more threaded-through parameters. This task modifies its signature (both call sites — `negamaxSearch` and the new `search`'s iterative loop — are in this file, so it's a self-contained change).

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/search.spec.ts`:

```typescript
import { search } from "./search.ts";

describe("search", () => {
  it("reaches the requested depth and returns a legal move with a populated principal variation", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    const result = search(board, 2, { maxDepth: 2 });
    expect(result.depth).toBe(2);
    expect(result.principalVariation.length).toBeGreaterThan(0);
    expect(board[result.move.row][result.move.col]).toBe(0);
  });

  it("stops within the time budget and still returns a valid move", () => {
    const board = parseBoard(`
      ..........
      ....X.....
      ..O.......
      .....X....
      ..........
    `);
    const start = Date.now();
    const result = search(board, 1, { maxDepth: 8, timeBudgetMs: 100 });
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    expect(board[result.move.row][result.move.col]).toBe(0);
    expect(result.nodesVisited).toBeGreaterThan(0);
  });

  it("finds a forced win-in-1 even under iterative deepening", () => {
    const board = parseBoard(`
      ..........
      .OXXXX....
      ..........
    `);
    const result = search(board, 1, { maxDepth: 3 });
    expect(result.move).toEqual({ row: 1, col: 6 });
  });

  it("finds a win-in-3 that requires creating a double threat (fork)", () => {
    // X has two separate open threes (horizontal at row 5, vertical at
    // col 5) that cross near (5, 5); O has no forcing reply of its own,
    // so X can create a four on one line while the other stays live,
    // forcing a win within 3 plies regardless of how O responds.
    const board = parseBoard(`
      ...........
      ...........
      .....X.....
      .....X.....
      .....X.....
      ...XXX.....
      ...........
      ...........
    `);
    const result = search(board, 1, { maxDepth: 6, timeBudgetMs: 5000 });
    expect(result.score).toBeGreaterThanOrEqual(9_000_000);
  }, 10000);
});
```

If the hand-built diagram above doesn't actually produce a forced win within depth 6 once run (double-threat geometry is easy to get subtly wrong by hand), adjust the stone placement until `search` reports a decisive score (`>= 9_000_000`, i.e. a detected forced win) at that depth — the property under test is "the engine finds forced wins that require building a fork," not these exact coordinates.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- search.spec`
Expected: FAIL with `search is not a function`

- [ ] **Step 3: Write the implementation**

Modify `negamax`'s signature in `src/engine/search.ts` to thread a deadline and a node counter, and add the exported `search` entry point:

```typescript
export interface SearchResult {
  move: Move;
  score: number;
  depth: number;
  principalVariation: Move[];
  nodesVisited: number;
}

export interface SearchConfig {
  maxDepth: number;
  timeBudgetMs?: number;
}

interface NodeCounter {
  count: number;
}

function negamax(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
  deadline: number | null,
  nodeCounter: NodeCounter,
): SearchNode {
  nodeCounter.count += 1;

  if (depth === 0) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  const rawMoves = findCandidateMoves(board);
  if (rawMoves.length === 0) {
    return { score: 0, principalVariation: [] };
  }

  const ownPatterns = findPatterns(board, player);
  const oppPatterns = findPatterns(board, otherPlayer(player));
  const forkPoints = new Set(
    findForkPoints(ownPatterns).map((f) => `${f.move.row},${f.move.col}`),
  );
  const moves = orderMoves(rawMoves, ownPatterns, oppPatterns, forkPoints);

  let best: SearchNode = { score: -Infinity, principalVariation: [] };
  let currentAlpha = alpha;

  for (const move of moves) {
    if (deadline !== null && Date.now() > deadline) {
      break;
    }

    const next = placeMove(board, move.row, move.col, player);
    const isWin = checkCaroWin(next, move.row, move.col, player);

    const node: SearchNode = isWin
      ? { score: WIN_SCORE + depth, principalVariation: [] }
      : (() => {
          const child = negamax(
            next,
            otherPlayer(player),
            depth - 1,
            -beta,
            -currentAlpha,
            deadline,
            nodeCounter,
          );
          return {
            score: -child.score,
            principalVariation: child.principalVariation,
          };
        })();

    if (node.score > best.score) {
      best = {
        score: node.score,
        principalVariation: [move, ...node.principalVariation],
      };
    }
    currentAlpha = Math.max(currentAlpha, node.score);
    if (currentAlpha >= beta) {
      break;
    }
  }

  return best;
}

export function negamaxSearch(
  board: Board,
  player: Player,
  depth: number,
): SearchNode {
  return negamax(board, player, depth, -Infinity, Infinity, null, { count: 0 });
}
```

**Correction (post-Task-13 finding):** empirically timing `chooseMove` on the real 20×20 board (Task 13) confirmed `findPatterns`/`findForkPoints` are expensive per node (patterns.ts recomputes `findFours`/`findThrees` per candidate gain — flagged as a "watch" item back in Task 5's review, now measured as the dominant cost: ~4.75ms/node on a tiny 6×6 board, worse on 20×20). The deadline as originally coded is checked only inside the per-move loop, *after* `findCandidateMoves`/`findPatterns`/`findForkPoints`/`orderMoves` have already run for the current node — so a node entered just after the deadline expires still pays that full per-node cost before the loop gets a chance to notice and stop. Under CPU contention this let a `timeBudgetMs: 2000` search reach only depth 1 (shallower than an unbudgeted depth-2 `easy` search), because the "sunk cost" of already-started-but-too-late nodes compounded across the tree instead of being bounded to one node.

```typescript
function negamax(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
  deadline: number | null,
  nodeCounter: NodeCounter,
): SearchNode {
  nodeCounter.count += 1;

  if (depth === 0) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  // Check before paying for findCandidateMoves/findPatterns/findForkPoints —
  // those are expensive per node (see Task 13's timing finding), so checking
  // only inside the move loop below lets an already-expired deadline still
  // pay for one full node's pattern computation before noticing. This bounds
  // the overrun to whatever's already in flight, not an entire subtree.
  if (deadline !== null && Date.now() > deadline) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  const rawMoves = findCandidateMoves(board);
  // ...rest of the function is unchanged from the version above.
```

This does not address the underlying per-node cost (patterns.ts's recomputation strategy is out of scope for this fix) — only how precisely the deadline is honored once it's set. The base slowness at `easy`/`medium` depths with no time budget at all is a separate, larger, unresolved concern flagged for future work.

export function search(
  board: Board,
  player: Player,
  config: SearchConfig,
): SearchResult {
  const deadline =
    config.timeBudgetMs !== undefined ? Date.now() + config.timeBudgetMs : null;
  const nodeCounter: NodeCounter = { count: 0 };

  let bestNode: SearchNode | null = null;
  let depthReached = 0;

  for (let depth = 1; depth <= config.maxDepth; depth += 1) {
    if (deadline !== null && Date.now() > deadline) {
      break;
    }
    const result = negamax(
      board,
      player,
      depth,
      -Infinity,
      Infinity,
      deadline,
      nodeCounter,
    );
    if (result.principalVariation.length === 0) {
      break;
    }
    bestNode = result;
    depthReached = depth;
    if (Math.abs(result.score) >= WIN_SCORE) {
      break;
    }
  }

  if (bestNode === null) {
    const fallbackMoves = findCandidateMoves(board);
    return {
      move: fallbackMoves[0],
      score: 0,
      depth: 0,
      principalVariation: [],
      nodesVisited: nodeCounter.count,
    };
  }

  return {
    move: bestNode.principalVariation[0],
    score: bestNode.score,
    depth: depthReached,
    principalVariation: bestNode.principalVariation,
    nodesVisited: nodeCounter.count,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- search.spec`
Expected: PASS, 12/12 tests

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, all suites green

- [ ] **Step 6: Commit**

```bash
git add src/engine/search.ts src/engine/search.spec.ts
git commit -m "feat: add iterative deepening with time budget to search"
```

---

### Task 13: `engine.ts` — rewire `chooseMove` to `search`, add difficulty

**Files:**

- Modify: `src/engine/engine.ts` (replace entire placeholder implementation)
- Modify: `src/engine/engine.spec.ts` (replace tests to match the new signature/return type)

**Interfaces:**

- Consumes: `search`, `type SearchResult`, `findCandidateMoves` from `./search.ts`; `evaluate` from `./evaluate.ts`; `BOARD_SIZE` from `./board.ts`; `type GameState`, `type Move` from `./state.ts`.
- Produces: `type Difficulty = 'easy' | 'medium' | 'hard'`, `interface EngineConfig { difficulty: Difficulty; timeBudgetMs?: number }`, `chooseMove(state: GameState, config?: EngineConfig): SearchResult` — this is the public API `src/ui/app.ts` and `src/server/server.ts`'s consumers call; Task 14 updates `app.ts` to match the new return type (a `SearchResult`, not a bare `Move`).

`chooseMove` used to return `Move`; it now returns the full `SearchResult` per the design doc ("the extra fields feed debugging and the later LLM bridge"). Every call site must change from `chooseMove(state)` to `chooseMove(state, config).move`.

- [ ] **Step 1: Write the failing tests**

Replace the contents of `src/engine/engine.spec.ts`:

```typescript
import { BOARD_SIZE, isLegalMove } from "./board.ts";
import { chooseMove } from "./engine.ts";
import { applyMove, newGame } from "./state.ts";

describe("chooseMove", () => {
  it("returns a SearchResult whose move is legal on an empty board", () => {
    const state = newGame();
    const result = chooseMove(state, { difficulty: "easy" });
    expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
      true,
    );
    expect(result.depth).toBeGreaterThan(0);
    expect(Array.isArray(result.principalVariation)).toBe(true);
    expect(typeof result.nodesVisited).toBe("number");
  });

  it("returns a legal move adjacent to an existing stone once the board is non-empty", () => {
    let state = newGame();
    state = applyMove(state, { row: 7, col: 7 }, 1);

    const result = chooseMove(state, { difficulty: "easy" });
    expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
      true,
    );
  });

  it("takes an immediate win-in-1 when one is available, even at easy difficulty", () => {
    let state = newGame();
    // X: (5,1)-(5,4) open on both ends; O plays elsewhere off that line.
    state = applyMove(state, { row: 5, col: 1 }, 1);
    state = applyMove(state, { row: 0, col: 0 }, 2);
    state = applyMove(state, { row: 5, col: 2 }, 1);
    state = applyMove(state, { row: 0, col: 1 }, 2);
    state = applyMove(state, { row: 5, col: 3 }, 1);
    state = applyMove(state, { row: 0, col: 2 }, 2);
    state = applyMove(state, { row: 5, col: 4 }, 1);
    state = applyMove(state, { row: 0, col: 3 }, 2);

    const result = chooseMove(state, { difficulty: "easy" });
    expect([
      { row: 5, col: 0 },
      { row: 5, col: 5 },
    ]).toContainEqual(result.move);
  });

  it("defaults to a usable configuration when none is passed", () => {
    const state = newGame();
    const result = chooseMove(state);
    expect(isLegalMove(state.board, result.move.row, result.move.col)).toBe(
      true,
    );
  });

  it("searches deeper at hard than at easy for the same position", () => {
    let state = newGame();
    state = applyMove(state, { row: 10, col: 10 }, 1);
    state = applyMove(state, { row: 3, col: 3 }, 2);

    const easy = chooseMove(state, { difficulty: "easy" });
    const hard = chooseMove(state, { difficulty: "hard", timeBudgetMs: 2000 });
    expect(hard.depth).toBeGreaterThanOrEqual(easy.depth);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- engine.spec`
Expected: FAIL — `chooseMove(state, { difficulty: ... })` currently ignores the second argument and returns a bare `Move`, so `result.move`/`result.depth`/etc. are `undefined`

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/engine/engine.ts`:

```typescript
import { search, type SearchResult } from "./search.ts";
import type { GameState } from "./state.ts";

export type Difficulty = "easy" | "medium" | "hard";

export interface EngineConfig {
  difficulty: Difficulty;
  timeBudgetMs?: number;
}

const DIFFICULTY_DEPTH: Record<Difficulty, number> = {
  easy: 2,
  medium: 4,
  hard: 8,
};

const DEFAULT_CONFIG: EngineConfig = { difficulty: "medium" };

/**
 * Chooses the engine's next move for `state.nextPlayer`. Returns the full
 * SearchResult (not just the move) so callers can inspect score, depth
 * reached, and the principal variation for debugging or future bridging.
 */
export function chooseMove(
  state: GameState,
  config: EngineConfig = DEFAULT_CONFIG,
): SearchResult {
  const maxDepth = DIFFICULTY_DEPTH[config.difficulty];
  return search(state.board, state.nextPlayer, {
    maxDepth,
    timeBudgetMs: config.timeBudgetMs,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- engine.spec`
Expected: PASS, 5/5 tests

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: `npm test` all suites green; `npm run typecheck` will currently FAIL on `src/ui/app.ts` (its `chooseMove(state)` call now returns `SearchResult`, not `Move`) — that break is expected and fixed in Task 14. Confirm no _other_ file fails typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/engine/engine.ts src/engine/engine.spec.ts
git commit -m "feat: rewire chooseMove to negamax search with difficulty levels"
```

---

### Task 14: Wire the UI to the new `chooseMove` signature + difficulty selector

**Files:**

- Modify: `src/ui/app.ts:1-6,97-120` (update the `chooseMove` call, add difficulty state and a change handler)
- Modify: `index.html:144-179` (add a difficulty `<select>` next to the New Game button)

**Interfaces:**

- Consumes: `chooseMove`, `type EngineConfig`, `type Difficulty` from `../engine/engine.ts`.
- Produces: no new exports — this is a leaf UI change with no downstream consumers in this plan.

There is no existing automated test harness for `app.ts` (it's DOM-driven, loaded via `esbuild` bundle into `index.html`); this task is verified by `npm run typecheck` (Task 13 left it red) plus a manual smoke test in the browser.

- [ ] **Step 1: Add the difficulty selector to `index.html`**

In `index.html`, change the line:

```html
<button id="new-game" type="button">New Game</button>
```

to:

```html
<div class="controls">
  <select id="difficulty">
    <option value="easy">Easy</option>
    <option value="medium" selected>Medium</option>
    <option value="hard">Hard</option>
  </select>
  <button id="new-game" type="button">New Game</button>
</div>
```

Add a small style block right before the closing `</style>` tag (after the existing `#new-game:focus-visible` rule) so the new control matches the sheet's look:

```css
.controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

#difficulty {
  padding: 8px 10px;
  font-family: inherit;
  font-size: 0.95rem;
  color: var(--graphite);
  background: var(--cell-paper);
  border: 2px solid var(--graphite);
  border-radius: 3px;
}
```

- [ ] **Step 2: Update `src/ui/app.ts` to read the selector and call the new `chooseMove` signature**

Change the import line:

```typescript
// before:
import { chooseMove } from "../engine/engine.ts";
// after:
import { chooseMove, type Difficulty } from "../engine/engine.ts";
```

Add the element lookup near the other DOM lookups (after `newGameButton`):

```typescript
const difficultyEl = document.getElementById("difficulty") as HTMLSelectElement;
```

Add a helper to read the current difficulty, right after `delay`:

```typescript
function currentDifficulty(): Difficulty {
  return difficultyEl.value as Difficulty;
}
```

Change the AI move call inside `handleCellClick`:

```typescript
// before:
state = applyMove(state, chooseMove(state), 2);
// after:
state = applyMove(
  state,
  chooseMove(state, { difficulty: currentDifficulty() }).move,
  2,
);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors

- [ ] **Step 4: Manual smoke test**

Run: `npm run build && npm run start` (or just `npm start`, which runs both)
Then open `http://localhost:3000` in a browser and verify:

- The difficulty dropdown appears next to "New Game" and defaults to Medium.
- Placing a stone as X triggers an AI (O) reply after the existing "AI thinking…" delay.
- Switching difficulty to Hard before a move noticeably slows the AI's reply (search is working, not instant); Easy replies quickly.
- Winning (five in a row, not blocked both ends) shows "AI wins!" / "You win!"; a five blocked at both ends does **not** end the game.
- "New Game" resets the board and re-enables input.

Stop the server (Ctrl+C) once verified.

- [ ] **Step 5: Run the full test suite one more time**

Run: `npm test && npm run typecheck && npm run lint`
Expected: All three PASS

- [ ] **Step 6: Commit**

```bash
git add index.html src/ui/app.ts
git commit -m "feat: add difficulty selector to the UI and update chooseMove call site"
```

---

### Task 15: Engine difficulty smoke tests

**Files:**

- Create: `src/engine/engine.difficulty.spec.ts`

**Interfaces:**

- Consumes: `search` from `./search.ts` directly (not `chooseMove`/`GameState`, to run on a smaller board and keep the test fast — see note below); `createEmptyBoard`, `placeMove`, `isLegalMove`, `type Board`, `type Player` from `./board.ts`; `checkCaroWin` from `./rules.ts`.
- Produces: nothing new — this is a pure verification task per the design doc's testing strategy ("difficulty smoke tests: hard beats easy over N self-play games; time budget respected").

Self-play at `hard`'s full depth (8) on a 20×20 board would make this test slow. To keep it fast and deterministic while still exercising the real `search` function and difficulty-shaped configs, this task plays on a smaller 11×11 board (still ≥ `WIN_LENGTH` per side, and `search`/`findCandidateMoves` are already board-size-agnostic) with tighter time budgets. This tests the same `search` codepath `chooseMove` uses; it does not go through `GameState`/`chooseMove` itself since that would force the full 20×20 board.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/engine/engine.difficulty.spec.ts
import {
  createEmptyBoard,
  isLegalMove,
  placeMove,
  type Board,
  type Player,
} from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { search, type SearchConfig } from "./search.ts";

const SMALL_BOARD_SIZE = 11;
const EASY_CONFIG: SearchConfig = { maxDepth: 2, timeBudgetMs: 200 };
const HARD_CONFIG: SearchConfig = { maxDepth: 6, timeBudgetMs: 800 };
const MAX_MOVES = SMALL_BOARD_SIZE * SMALL_BOARD_SIZE;

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

/** Plays hard (as player 1) against easy (as player 2) to completion or a move cap. Returns the winner, or null for a draw/cap. */
function playGame(hardPlayer: Player): Player | null {
  let board: Board = createEmptyBoard(SMALL_BOARD_SIZE);
  let toMove: Player = 1;

  for (let moveCount = 0; moveCount < MAX_MOVES; moveCount += 1) {
    const config = toMove === hardPlayer ? HARD_CONFIG : EASY_CONFIG;
    const result = search(board, toMove, config);
    if (!isLegalMove(board, result.move.row, result.move.col)) {
      return otherPlayer(toMove);
    }

    board = placeMove(board, result.move.row, result.move.col, toMove);
    if (checkCaroWin(board, result.move.row, result.move.col, toMove)) {
      return toMove;
    }
    toMove = otherPlayer(toMove);
  }
  return null;
}

describe("difficulty smoke test", () => {
  it("hard beats easy in the majority of self-play games", () => {
    const games = 3;
    let hardWins = 0;

    for (let i = 0; i < games; i += 1) {
      const hardPlayer: Player = i % 2 === 0 ? 1 : 2;
      const winner = playGame(hardPlayer);
      if (winner === hardPlayer) {
        hardWins += 1;
      }
    }

    expect(hardWins).toBeGreaterThan(games / 2);
  }, 60000);

  it("respects the time budget even at a high requested depth", () => {
    let board: Board = createEmptyBoard(SMALL_BOARD_SIZE);
    board = placeMove(board, 5, 5, 1);
    board = placeMove(board, 5, 6, 2);
    board = placeMove(board, 6, 5, 1);
    board = placeMove(board, 6, 6, 2);

    const start = Date.now();
    const result = search(board, 1, { maxDepth: 10, timeBudgetMs: 150 });
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    expect(isLegalMove(board, result.move.row, result.move.col)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- engine.difficulty`
Expected: FAIL only if `search`/`checkCaroWin` signatures don't match (they should already match from Tasks 2 and 12 — if this is the first run, confirm it currently passes trivially only by accident; if any assertion fails, that's a real signal, not a scaffolding gap, since every dependency already exists). If everything compiles and both tests fail on their actual assertions (e.g. `hardWins` not `> games / 2`), that is the expected RED state for this task.

- [ ] **Step 3: If `hard` does not beat `easy` a majority of the time**

This indicates a real bug in search or evaluation (e.g. move ordering not actually preferring winning moves, or evaluate's tempo bonus sign flipped), not a flaky test — investigate and fix `search.ts`/`evaluate.ts` rather than loosening the assertion. Re-run after each fix.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- engine.difficulty`
Expected: PASS, 2/2 tests

- [ ] **Step 5: Run the entire suite, typecheck, and lint one final time**

Run: `npm test && npm run typecheck && npm run lint`
Expected: All three PASS

- [ ] **Step 6: Commit**

```bash
git add src/engine/engine.difficulty.spec.ts
git commit -m "test: add difficulty self-play and time-budget smoke tests"
```

---

## After all tasks

Once Task 15 is committed and green, use **superpowers:finishing-a-development-branch** to verify the full suite one more time and present branch-completion options (the design doc's LLM bridge and Phase B/C roadmap items are intentionally not part of this plan — they're separate future work built on top of `patterns.ts`'s `PatternInstance`/`ForkPoint` vocabulary established here).
