import {
  type Board,
  type Cell,
  type Player,
} from "./board.ts";
import {
  findPatterns,
  findPatternsOnLine,
  lineKey,
  PATTERN_DIRECTIONS,
  type PatternInstance,
} from "./patterns.ts";
import type { Move } from "./state.ts";

type UndoFrame = {
  row: number;
  col: number;
  previousCell: Cell;
  patterns1: PatternInstance[];
  patterns2: PatternInstance[];
};

function patternOnLine(
  pattern: PatternInstance,
  direction: readonly [number, number],
  key: number,
): boolean {
  if (
    pattern.direction[0] !== direction[0] ||
    pattern.direction[1] !== direction[1]
  ) {
    return false;
  }
  return pattern.cells.some(
    (c) => lineKey(c.row, c.col, direction) === key,
  );
}

/**
 * Mutable board plus cached patterns for both players. Search and the UI
 * update via place/undo (4-line rebuild) instead of full-board rescans.
 */
export class PatternStore {
  readonly board: Board;
  private patterns1: PatternInstance[];
  private patterns2: PatternInstance[];
  private stack: UndoFrame[] = [];

  private constructor(
    board: Board,
    patterns1: PatternInstance[],
    patterns2: PatternInstance[],
  ) {
    this.board = board;
    this.patterns1 = patterns1;
    this.patterns2 = patterns2;
  }

  /** Deep-copies `board` and runs a full `findPatterns` for both players. */
  static fromBoard(board: Board): PatternStore {
    const copy = board.map((row) => row.slice()) as Board;
    return new PatternStore(
      copy,
      findPatterns(copy, 1),
      findPatterns(copy, 2),
    );
  }

  patterns(player: Player): readonly PatternInstance[] {
    return player === 1 ? this.patterns1 : this.patterns2;
  }

  get depth(): number {
    return this.stack.length;
  }

  /**
   * Place `player` at `move` (must be empty). Updates board + caches via
   * 4-line rebuild and pushes an undo frame.
   */
  place(move: Move, player: Player): void {
    const { row, col } = move;
    if (this.board[row][col] !== 0) {
      throw new Error(`PatternStore.place: occupied (${row},${col})`);
    }
    this.stack.push({
      row,
      col,
      previousCell: 0,
      patterns1: this.patterns1,
      patterns2: this.patterns2,
    });
    this.board[row][col] = player;
    this.patterns1 = this.patterns1.slice();
    this.patterns2 = this.patterns2.slice();
    this.rebuildLinesThrough(row, col);
  }

  /** Restore board cell and pattern caches from the last `place`. */
  undo(): void {
    const frame = this.stack.pop();
    if (!frame) {
      throw new Error("PatternStore.undo: empty stack");
    }
    this.board[frame.row][frame.col] = frame.previousCell;
    this.patterns1 = frame.patterns1;
    this.patterns2 = frame.patterns2;
  }

  /**
   * Drop the undo stack and rebuild caches from `board` (deep copy).
   * Used for UI load / new-game / history jumps that are not place/undo.
   */
  resetFromBoard(board: Board): void {
    const copy = board.map((row) => row.slice()) as Board;
    for (let row = 0; row < this.board.length; row += 1) {
      for (let col = 0; col < this.board.length; col += 1) {
        this.board[row][col] = copy[row][col];
      }
    }
    this.patterns1 = findPatterns(this.board, 1);
    this.patterns2 = findPatterns(this.board, 2);
    this.stack = [];
  }

  private rebuildLinesThrough(row: number, col: number): void {
    for (const direction of PATTERN_DIRECTIONS) {
      const key = lineKey(row, col, direction);
      this.patterns1 = this.patterns1.filter(
        (p) => !patternOnLine(p, direction, key),
      );
      this.patterns2 = this.patterns2.filter(
        (p) => !patternOnLine(p, direction, key),
      );
      this.patterns1.push(
        ...findPatternsOnLine(this.board, 1, row, col, direction),
      );
      this.patterns2.push(
        ...findPatternsOnLine(this.board, 2, row, col, direction),
      );
    }
  }
}
