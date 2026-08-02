// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { tryUseExperienceHit } from "./experienceLookup.ts";
import { newGame } from "../state.ts";

const board = newGame().board;
const strong = { move: { row: 7, col: 7 }, score: 100, depth: 4 };

it("practice: does not instant-replay a non-permanent hit (improvement on)", () => {
  const res = tryUseExperienceHit({
    board,
    player: 1,
    mode: "practice",
    entry: { ...strong, stallCount: 0 },
    settleGiveUpSearches: 3,
  });
  expect(res).toBeNull();
});

it("practice: instant-replays once stallCount reaches the give-up threshold", () => {
  const res = tryUseExperienceHit({
    board,
    player: 1,
    mode: "practice",
    entry: { ...strong, stallCount: 3 },
    settleGiveUpSearches: 3,
  });
  expect(res?.move).toEqual(strong.move);
});
