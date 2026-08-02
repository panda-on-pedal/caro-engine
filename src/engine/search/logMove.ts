// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import type { Move } from "../state.ts";

/** `row,col` for search debug logs. */
export function logMoveKey(move: Move): string {
  return `${move.row},${move.col}`;
}
