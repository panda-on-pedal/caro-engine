import { parseBoard } from "../test-helpers/parse-board.ts";
import { narrowCandidates, ALL_FORK_PATTERN_NAMES } from "./narrow.ts";
import { DEFAULT_DECAY_CONFIG } from "./search.ts";
import { discoverOpponentThreatBlocks } from "./threatProbe.ts";

const CFG = {
  recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
  decay: DEFAULT_DECAY_CONFIG,
};

/** Catalog #20 — X to move; 13,6 is a prophylactic block of O's multi-ply force. */
const CATALOG_20 = parseBoard(`
     3  4  5  6  7  8  9 10 11 12 13 14
  6  .  .  .  .  .  .  .  .  .  .  .  .
  7  .  .  O  .  O  .  X  O  .  .  .  .
  8  .  X  .  X  .  O  .  O  .  O  .  .
  9  .  .  O  .  X  O  O  X  X  .  .  .
 10  .  O  X  X  X  X  O  X  .  X  .  .
 11  .  .  .  O  X  O  X  X  X  O  X  .
 12  .  .  .  .  O  X  .  O  .  .  .  .
 13  .  .  .  .  .  .  O  .  .  .  .  .
 14  .  .  .  O  .  .  .  .  .  .  .  .
 15  .  .  .  .  .  .  .  .  .  .  .  .
`);

describe("discoverOpponentThreatBlocks", () => {
  it("includes catalog #20's 13,6 even though narrowCandidates omits it", () => {
    const narrowed = narrowCandidates(CATALOG_20, 1, 36, CFG);
    const narrowKeys = new Set(narrowed.moves.map(m => `${m.row},${m.col}`));
    expect(narrowKeys.has("13,6")).toBe(false);

    const blocks = discoverOpponentThreatBlocks(CATALOG_20, 1, {
      excludeMoves: narrowed.moves,
    });
    expect(blocks.map(m => `${m.row},${m.col}`)).toContain("13,6");
  });
});
