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
  it("finds catalog #20's 13,6 — a gain that hands O a winning four next ply", () => {
    const blocks = discoverOpponentThreatBlocks(CATALOG_20, 1);
    expect(blocks.map(m => `${m.row},${m.col}`)).toContain("13,6");
  });

  it("skips cells narrowing already covers", () => {
    // 13,6 is one of O's mixed-tier fork lines here, so narrowing now
    // forces it directly; the probe stays for the forcing gains that are
    // not fork cells and would otherwise be crowded out of top-K.
    const narrowed = narrowCandidates(CATALOG_20, 1, 36, CFG);
    expect(narrowed.moves.map(m => `${m.row},${m.col}`)).toContain("13,6");

    const blocks = discoverOpponentThreatBlocks(CATALOG_20, 1, {
      excludeMoves: narrowed.moves,
    });
    expect(blocks.map(m => `${m.row},${m.col}`)).not.toContain("13,6");
  });
});
