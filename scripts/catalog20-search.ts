// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

// Probe catalog #20: does search lookahead prefer 12,11 (static #1) or see
// the punishment line X 12,11 → O 12,6 → X 12,12 → O 15,11?
//
// Run from the repo root:
//   node --experimental-strip-types scripts/catalog20-search.ts
import { parseBoard } from "../src/engine/test-helpers/parse-board.ts";
import { placeMove, type Board, type Player } from "../src/engine/board.ts";
import { checkCaroWin } from "../src/engine/rules.ts";
import { search, negamaxStrategy, DEFAULT_DECAY_CONFIG } from "../src/engine/search/search.ts";
import { narrowCandidates, ALL_FORK_PATTERN_NAMES } from "../src/engine/search/narrow.ts";
import { scoreMove } from "../src/engine/search/rankMoves.ts";
import { logger } from "../src/utils/logger.ts";
import type { Move } from "../src/engine/state.ts";

logger.setDebug(true);

const board = parseBoard(`
       5  6  7  8  9 10 11 12 13 14 15
    5  .  .  .  .  .  .  .  .  .  .  .
    6  .  X  .  .  .  .  .  .  .  .  .
    7  .  .  X  .  .  .  .  .  .  .  .
    8  .  .  .  O  .  .  .  .  .  .  .
    9  .  .  .  .  X  .  .  .  .  .  .
   10  .  .  .  X  O  X  X  X  X  O  .
   11  .  .  .  .  O  .  O  X  .  .  .
   12  .  .  .  O  O  O  .  .  .  .  .
   13  .  .  .  O  O  X  O  .  .  .  .
   14  .  .  .  O  .  .  .  O  .  .  .
   15  .  .  X  O  X  .  .  .  .  .  .
   16  .  .  .  X  .  .  .  .  .  X  .
   17  .  .  .  .  .  .  .  .  .  .  .
`);

const CFG = {
  recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
  decay: DEFAULT_DECAY_CONFIG,
  rootScoreJitter: 0,
  rng: () => 0.5,
};

const SYMBOLS = [".", "X", "O"] as const;

function fmt(m: Move): string {
  return `${m.row},${m.col}`;
}

function fmtPv(pv: Move[]): string {
  return pv.map(fmt).join(" → ") || "(empty)";
}

function printBoard(b: Board, minRow = 5, maxRow = 17, minCol = 5, maxCol = 15): void {
  const header = ["  "];
  for (let c = minCol; c <= maxCol; c += 1) {
    header.push(String(c).padStart(2));
  }
  console.log(header.join(" "));
  for (let r = minRow; r <= maxRow; r += 1) {
    const line = [String(r).padStart(2)];
    for (let c = minCol; c <= maxCol; c += 1) {
      line.push(SYMBOLS[b[r][c]].padStart(2));
    }
    console.log(line.join(" "));
  }
}

function countStones(b: Board): number {
  let n = 0;
  for (const row of b) {
    for (const cell of row) {
      if (cell !== 0) n += 1;
    }
  }
  return n;
}

console.log("\n========== A) Root narrow + static scores ==========");
const moveCount = countStones(board);
const narrowed = narrowCandidates(board, 1, moveCount, CFG);
console.log("source:", narrowed.source);
console.log(
  "candidates:",
  narrowed.moves.map(m => `${fmt(m)} (static ${scoreMove(board, 1, m)})`).join(", ")
);

console.log("\n========== B) Full search (hard-like: depth 6, 5s, no jitter) ==========");
const rootEvents: string[] = [];
const root = search(board, 1, {
  ...CFG,
  maxDepth: 6,
  timeBudgetMs: 5000,
  onProgress: ev => {
    if (ev.type === "bestSoFar") {
      rootEvents.push(`bestSoFar ${ev.row},${ev.col}`);
    } else if (ev.type === "deeper") {
      rootEvents.push(`deeper d=${ev.depth}`);
    } else if (ev.type === "searchStats") {
      rootEvents.push(`stats d=${ev.depth} nodes=${ev.nodes}`);
    } else if (ev.type === "candidates") {
      rootEvents.push(`candidates n=${ev.count} source=${ev.source}`);
    }
  },
});
console.log("chosen:", fmt(root.move));
console.log("score:", root.score);
console.log("depthReached:", root.depth);
console.log("nodes:", root.nodesVisited);
console.log("PV:", fmtPv(root.principalVariation));
console.log("progress:", rootEvents.join(" | "));

console.log("\n========== C) Per-root-candidate scores at depths 2/4/6 ==========");
for (const depth of [2, 4, 6]) {
  const result = negamaxStrategy(board, 1, narrowed.moves, {
    ...CFG,
    maxDepth: depth,
    // no time budget — finish the depth
  });
  console.log(`depth=${depth}: best=${fmt(result.move)} score=${result.score} PV=${fmtPv(result.principalVariation)} nodes=${result.nodesVisited}`);
}

console.log("\n========== D) Score each interesting root move in isolation (depth 6) ==========");
for (const m of [
  { row: 12, col: 11 },
  { row: 12, col: 6 },
  { row: 12, col: 12 },
]) {
  const result = negamaxStrategy(board, 1, [m], {
    ...CFG,
    maxDepth: 6,
  });
  console.log(
    `${fmt(m)} alone: score=${result.score} depth=${result.depth} PV=${fmtPv(result.principalVariation)} nodes=${result.nodesVisited}`
  );
}

console.log("\n========== E) Forced threat line playout ==========");
// Claimed line: X 12,11 → O 12,6 → X 12,12 → O 15,11
const line: Array<{ player: Player; move: Move; note: string }> = [
  { player: 1, move: { row: 12, col: 11 }, note: "X catalog block (static #1)" },
  { player: 2, move: { row: 12, col: 6 }, note: "O claimed punishment" },
  { player: 1, move: { row: 12, col: 12 }, note: "X must-block horizontal four?" },
  { player: 2, move: { row: 15, col: 11 }, note: "O claimed unstoppable shared four+OT" },
];

let b = board;
let ply = 0;
for (const step of line) {
  ply += 1;
  // Before forced O/X replies, ask what search actually wants.
  if (ply > 1) {
    const free = search(b, step.player, {
      ...CFG,
      maxDepth: 6,
      timeBudgetMs: 5000,
    });
    console.log(
      `\n[before forcing ${SYMBOLS[step.player]} ${fmt(step.move)}] search wants ${fmt(free.move)} score=${free.score} PV=${fmtPv(free.principalVariation)}`
    );
    const wantsClaimed =
      free.move.row === step.move.row && free.move.col === step.move.col;
    console.log(
      wantsClaimed
        ? `  → search AGREES with claimed ${fmt(step.move)}`
        : `  → search DISAGREES (claimed ${fmt(step.move)}, chose ${fmt(free.move)})`
    );
  }

  b = placeMove(b, step.move.row, step.move.col, step.player);
  const win = checkCaroWin(b, step.move.row, step.move.col, step.player);
  console.log(
    `ply ${ply}: ${SYMBOLS[step.player]} ${fmt(step.move)} — ${step.note}${win ? " *** WIN ***" : ""}`
  );
}

console.log("\nBoard after forced line:");
printBoard(b);

console.log("\n========== F) After X=12,11 only: O's search reply ==========");
const afterX = placeMove(board, 12, 11, 1);
const oReply = search(afterX, 2, {
  ...CFG,
  maxDepth: 6,
  timeBudgetMs: 5000,
});
console.log("O chooses:", fmt(oReply.move));
console.log("score:", oReply.score);
console.log("depth:", oReply.depth);
console.log("PV:", fmtPv(oReply.principalVariation));
const oNarrow = narrowCandidates(afterX, 2, moveCount + 1, CFG);
console.log(
  "O candidates:",
  oNarrow.moves.map(m => `${fmt(m)} (static ${scoreMove(afterX, 2, m)})`).join(", ")
);

console.log("\n========== G) After X=12,6 instead: O's search reply ==========");
const afterAlt = placeMove(board, 12, 6, 1);
const oReplyAlt = search(afterAlt, 2, {
  ...CFG,
  maxDepth: 6,
  timeBudgetMs: 5000,
});
console.log("O chooses:", fmt(oReplyAlt.move));
console.log("score:", oReplyAlt.score);
console.log("PV:", fmtPv(oReplyAlt.principalVariation));
