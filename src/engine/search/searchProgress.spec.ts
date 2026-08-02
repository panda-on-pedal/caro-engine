// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { search, type SearchProgressEvent } from "./search.ts";
import { parseBoard } from "../test-helpers/parse-board.ts";

describe("search onProgress", () => {
  it("emits phase/candidates/examining/bestSoFar when negamax searches root moves", () => {
    // Both sides have open threes — narrowing keeps several candidates and
    // runs negamax rather than the quiet/single-candidate shortcut.
    const board = parseBoard(`
      ........
      ..XXX...
      ........
      ..OOO...
      ........
    `);
    const events: SearchProgressEvent[] = [];
    const result = search({
      board,
      player: 1,
      maxDepth: 2,
      onProgress: (event: SearchProgressEvent) => {
        events.push(event);
      },
    });

    expect(result.move).toBeDefined();
    expect(events.some(event => event.type === "phase" && event.phase === "searching")).toBe(true);
    expect(events.some(event => event.type === "candidates")).toBe(true);
    expect(events.some(event => event.type === "examining")).toBe(true);
    expect(events.some(event => event.type === "bestSoFar")).toBe(true);
    expect(events.some(event => event.type === "deeper")).toBe(true);
  });

  it("emits a quiet phase on a quiet board without examining storm", () => {
    const board = parseBoard(`
      .....
      .....
      ..X..
      .....
      .....
    `);
    const events: SearchProgressEvent[] = [];
    search({
      board,
      player: 2,
      maxDepth: 4,
      onProgress: (event: SearchProgressEvent) => {
        events.push(event);
      },
    });

    expect(events.some(event => event.type === "phase" && event.phase === "quiet")).toBe(true);
    expect(events.some(event => event.type === "examining")).toBe(false);
    expect(events.some(event => event.type === "deeper")).toBe(false);
  });

  it("behaves the same when onProgress is omitted", () => {
    const board = parseBoard(`
      ........
      ..XXX...
      ........
      ..OOO...
      ........
    `);
    const withCb = search({ board: board, player: 1, maxDepth: 2,
      onProgress: () => undefined,
      rng: () => 0.5, });
    const withoutCb = search({ board: board, player: 1, maxDepth: 2,
      rng: () => 0.5, });
    expect(withoutCb.move).toEqual(withCb.move);
    expect(withoutCb.score).toBe(withCb.score);
    expect(withoutCb.depth).toBe(withCb.depth);
  });
});
