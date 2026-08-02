// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { handleEngineRequest, type EngineRequest } from "./engineProtocol.ts";
import { createEmptyBoard } from "../engine/board.ts";

describe("handleEngineRequest rootCandidates", () => {
  it("returns a move only from the supplied slice", () => {
    const board = createEmptyBoard();
    board[7][7] = 1;
    board[7][8] = 2;
    board[8][7] = 1;
    const slice = [
      { row: 6, col: 6 },
      { row: 9, col: 9 },
    ];
    const request: EngineRequest = {
      id: 1,
      board,
      player: 2,
      difficulty: "expert",
      experienceMode: "off",
      rootCandidates: slice,
    };
    const res = handleEngineRequest(request);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(slice).toContainEqual(res.result.move);
    }
  });
});
