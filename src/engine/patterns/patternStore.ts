// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { type Board, type Cell, type Player } from "../board.ts";
import {
  findPatterns,
  findPatternsOnLine,
  lineKey,
  PATTERN_DIRECTIONS,
  type PatternInstance,
} from "./patterns.ts";
import type { Move } from "../state.ts";
import { zobristTerm } from "../transposition/zobrist.ts";

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
  key: number
): boolean {
  if (pattern.direction[0] !== direction[0] || pattern.direction[1] !== direction[1]) {
    return false;
  }
  return pattern.cells.some(c => lineKey(c.row, c.col, direction) === key);
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
  private hashValue: bigint;

  private constructor(board: Board, patterns1: PatternInstance[], patterns2: PatternInstance[]) {
    this.board = board;
    this.patterns1 = patterns1;
    this.patterns2 = patterns2;
    this.hashValue = PatternStore.computeHash(board);
  }

  private static computeHash(board: Board): bigint {
    let h = 0n;
    for (let row = 0; row < board.length; row += 1) {
      for (let col = 0; col < board.length; col += 1) {
        const cell = board[row][col];
        if (cell !== 0) {
          h ^= zobristTerm(row, col, cell);
        }
      }
    }
    return h;
  }

  get hash(): bigint {
    return this.hashValue;
  }

  /** Deep-copies `board` and runs a full `findPatterns` for both players. */
  static fromBoard(board: Board): PatternStore {
    const copy = board.map(row => row.slice()) as Board;
    return new PatternStore(copy, findPatterns(copy, 1), findPatterns(copy, 2));
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
    this.hashValue ^= zobristTerm(row, col, player);
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
    const removed = this.board[frame.row][frame.col];
    if (removed !== 0) {
      this.hashValue ^= zobristTerm(frame.row, frame.col, removed);
    }
    this.board[frame.row][frame.col] = frame.previousCell;
    this.patterns1 = frame.patterns1;
    this.patterns2 = frame.patterns2;
  }

  /**
   * Undo back down to `depth` (a value previously read from `depth`).
   * Lets a borrowed store be returned exactly as lent even when a caller
   * escapes between place and undo. No-op when already at or below `depth`.
   */
  unwindTo(depth: number): void {
    while (this.stack.length > depth) {
      this.undo();
    }
  }

  /**
   * Drop the undo history, keeping the current position and caches. Callers
   * that hold one store across many positions (the worker cache) use this so
   * the stack — and the pattern arrays its frames pin — cannot grow unbounded.
   */
  clearHistory(): void {
    this.stack = [];
  }

  /**
   * Bring this store to `board` cheaply: when `board` only *adds* stones to
   * the current position, place them (4-line rebuild each); anything else
   * (a removed or recoloured stone, a different size) falls back to a full
   * `resetFromBoard`. Returns true when the incremental path was taken.
   *
   * Placement order does not matter: every line whose contents changed passes
   * through at least one added stone, and such a line is rebuilt again when
   * the last stone on it is placed — by which point the board already holds
   * every addition.
   */
  syncToBoard(board: Board): boolean {
    if (board.length !== this.board.length) {
      this.resetFromBoard(board);
      return false;
    }
    const added: Array<{ move: Move; player: Player }> = [];
    for (let row = 0; row < board.length; row += 1) {
      for (let col = 0; col < board.length; col += 1) {
        const want = board[row][col];
        const have = this.board[row][col];
        if (want === have) {
          continue;
        }
        // `have !== 0` is a removed or recoloured stone; `want === 0` cannot
        // co-occur with `have === 0` here, but keeps `want` narrowed to Player.
        if (have !== 0 || want === 0) {
          this.resetFromBoard(board);
          return false;
        }
        added.push({ move: { row, col }, player: want });
      }
    }
    for (const { move, player } of added) {
      this.place(move, player);
    }
    return true;
  }

  /**
   * Drop the undo stack and rebuild caches from `board` (deep copy).
   * Used for UI load / new-game / history jumps that are not place/undo.
   */
  resetFromBoard(board: Board): void {
    const copy = board.map(row => row.slice()) as Board;
    for (let row = 0; row < this.board.length; row += 1) {
      for (let col = 0; col < this.board.length; col += 1) {
        this.board[row][col] = copy[row][col];
      }
    }
    this.patterns1 = findPatterns(this.board, 1);
    this.patterns2 = findPatterns(this.board, 2);
    this.stack = [];
    this.hashValue = PatternStore.computeHash(this.board);
  }

  private rebuildLinesThrough(row: number, col: number): void {
    for (const direction of PATTERN_DIRECTIONS) {
      const key = lineKey(row, col, direction);
      this.patterns1 = this.patterns1.filter(p => !patternOnLine(p, direction, key));
      this.patterns2 = this.patterns2.filter(p => !patternOnLine(p, direction, key));
      this.patterns1.push(...findPatternsOnLine(this.board, 1, row, col, direction));
      this.patterns2.push(...findPatternsOnLine(this.board, 2, row, col, direction));
    }
  }
}
