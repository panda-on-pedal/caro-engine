import type { Move } from "../state.ts";

/** `row,col` for search debug logs. */
export function logMoveKey(move: Move): string {
  return `${move.row},${move.col}`;
}
