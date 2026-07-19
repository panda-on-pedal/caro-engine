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

export type Direction = readonly [number, number];

const DIRECTIONS: ReadonlyArray<Direction> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** The four scan directions used by pattern detection. */
export const PATTERN_DIRECTIONS: ReadonlyArray<Direction> = DIRECTIONS;

/**
 * Line identity for `direction` through `(row, col)`:
 * horizontal → row; vertical → col; diag ↘ → row-col; diag ↙ → row+col.
 */
export function lineKey(
  row: number,
  col: number,
  direction: Direction,
): number {
  const dRow = direction[0];
  const dCol = direction[1];
  if (dRow === 0 && dCol === 1) {
    return row;
  }
  if (dRow === 1 && dCol === 0) {
    return col;
  }
  if (dRow === 1 && dCol === 1) {
    return row - col;
  }
  if (dRow === 1 && dCol === -1) {
    return row + col;
  }
  throw new Error(`Unsupported direction: ${dRow},${dCol}`);
}

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
  lineFilterKey?: number,
): WindowInfo[] {
  const direction: Direction = [dRow, dCol];
  const results: WindowInfo[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (
        lineFilterKey !== undefined &&
        lineKey(row, col, direction) !== lineFilterKey
      ) {
        continue;
      }
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
  lineFilterKey?: number,
): PatternInstance[] {
  return viableWindowsInDirection(
    read,
    size,
    dRow,
    dCol,
    player,
    lineFilterKey,
  )
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
  lineFilterKey?: number,
): PatternInstance[] {
  const windows = viableWindowsInDirection(
    read,
    size,
    dRow,
    dCol,
    player,
    lineFilterKey,
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

function findThrees(
  read: CellReader,
  size: number,
  dRow: number,
  dCol: number,
  player: Player,
  lineFilterKey?: number,
): PatternInstance[] {
  const windows = viableWindowsInDirection(
    read,
    size,
    dRow,
    dCol,
    player,
    lineFilterKey,
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
      const fours = findFours(
        hypothetical,
        size,
        dRow,
        dCol,
        player,
        lineFilterKey,
      );
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

function findTwos(
  read: CellReader,
  size: number,
  dRow: number,
  dCol: number,
  player: Player,
  lineFilterKey?: number,
): PatternInstance[] {
  const windows = viableWindowsInDirection(
    read,
    size,
    dRow,
    dCol,
    player,
    lineFilterKey,
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
      const threes = findThrees(
        hypothetical,
        size,
        dRow,
        dCol,
        player,
        lineFilterKey,
      );
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

function findPatternsInDirection(
  read: CellReader,
  size: number,
  dRow: number,
  dCol: number,
  player: Player,
  lineFilterKey?: number,
): PatternInstance[] {
  return [
    ...findFives(read, size, dRow, dCol, player, lineFilterKey),
    ...findFours(read, size, dRow, dCol, player, lineFilterKey),
    ...findThrees(read, size, dRow, dCol, player, lineFilterKey),
    ...findTwos(read, size, dRow, dCol, player, lineFilterKey),
  ];
}

export function findPatterns(board: Board, player: Player): PatternInstance[] {
  const read = boardReader(board);
  const size = board.length;
  const instances: PatternInstance[] = [];
  for (const [dRow, dCol] of DIRECTIONS) {
    instances.push(
      ...findPatternsInDirection(read, size, dRow, dCol, player),
    );
  }
  return instances;
}

/**
 * Patterns for `player` on the single line through `(anchorRow, anchorCol)`
 * in `direction`. Same classification as `findPatterns`, restricted to that
 * line's windows.
 */
export function findPatternsOnLine(
  board: Board,
  player: Player,
  anchorRow: number,
  anchorCol: number,
  direction: Direction,
): PatternInstance[] {
  const read = boardReader(board);
  const size = board.length;
  const key = lineKey(anchorRow, anchorCol, direction);
  return findPatternsInDirection(
    read,
    size,
    direction[0],
    direction[1],
    player,
    key,
  );
}

export interface ForkPoint {
  move: Move;
  player: Player;
  patterns: PatternInstance[];
}

/**
 * A fork point is an empty cell that appears in the `gains` of two or more
 * of the player's DISTINCT pattern instances — i.e. a single move that
 * advances two separate lines at once. Distinctness is by pattern instance
 * (stone set), not by direction: two disjoint groups on the *same* line
 * (e.g. two open-twos three rows apart on one column, meeting at the
 * midpoint) are still two separate threats, exactly as much as two lines
 * that cross in different directions.
 *
 * This deliberately uses the full `gains`, not just `criticalGains`: a
 * fork doesn't require both lines to promote all the way to their next
 * severity tier on their own — one line completing to a plain "four" while
 * the other merely advances (a classic three-four combo, since *any* gain
 * of a three-tier pattern already produces a four-tier group by
 * definition) is just as real a candidate as two lines promoting
 * symmetrically. Whether a given fork point is actually forcing, or just
 * a promising shared point, is for `scoreMove`/search to judge — this
 * function's job is only to make sure the point is never pruned out of
 * candidacy before that judgment can happen.
 */
export function findForkPoints(
  patterns: readonly PatternInstance[],
): ForkPoint[] {
  const byGain = new Map<string, PatternInstance[]>();
  for (const pattern of patterns) {
    for (const gain of pattern.gains) {
      const key = cellKey(gain);
      const list = byGain.get(key) ?? [];
      list.push(pattern);
      byGain.set(key, list);
    }
  }

  const forkPoints: ForkPoint[] = [];
  for (const [key, list] of byGain) {
    if (list.length < 2) {
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
