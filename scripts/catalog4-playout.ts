// Playout for board-state-catalog.md scenario #4: force X's first move to
// 9,9 (the offense move) and let the engine play BOTH sides from there,
// each turn choosing its best move via search(). Logs every move and the
// board so the losing sequence is visible.
//
// Run from the repo root:
//   node --experimental-strip-types scripts/catalog4-playout.ts
import { parseBoard } from "../src/engine/test-helpers/parse-board.ts";
import { placeMove, type Board, type Player } from "../src/engine/board.ts";
import { checkCaroWin } from "../src/engine/rules.ts";
import { search } from "../src/engine/search.ts";

const start = parseBoard(`
       6  7  8  9 10 11 12 13 14 15 16 17
    6  .  .  .  .  .  .  .  .  .  .  .  .
    7  .  .  .  .  .  .  .  .  .  .  .  .
    8  .  .  .  .  .  .  .  .  .  .  .  .
    9  .  .  .  .  .  .  .  .  .  .  .  .
   10  .  .  .  .  .  .  .  .  .  .  .  .
   11  .  .  .  O  .  X  .  .  .  .  .  .
   12  .  .  .  .  O  .  X  .  .  .  .  .
   13  .  .  .  .  .  O  .  .  .  .  .  .
   14  .  .  .  .  .  .  .  .  .  .  .  .
   15  .  .  .  .  .  .  .  .  .  .  .  .
   16  .  .  .  .  .  .  .  .  .  .  .  .
`);

const SYMBOLS = [".", "X", "O"] as const;

function printBoard(board: Board, minRow: number, maxRow: number, minCol: number, maxCol: number): void {
  const header = ["  "];
  for (let c = minCol; c <= maxCol; c += 1) {
    header.push(String(c).padStart(2));
  }
  console.log(header.join(" "));
  for (let r = minRow; r <= maxRow; r += 1) {
    const line = [String(r).padStart(2)];
    for (let c = minCol; c <= maxCol; c += 1) {
      line.push(SYMBOLS[board[r][c]].padStart(2));
    }
    console.log(line.join(" "));
  }
}

function playout(firstMove: { row: number; col: number }): void {
  console.log(`\n=== Playout: X opens with ${firstMove.row},${firstMove.col} ===`);
  let board = placeMove(start, firstMove.row, firstMove.col, 1);
  let player: Player = 2; // O replies
  console.log(`move 1: X plays ${firstMove.row},${firstMove.col} (forced by this experiment)`);

  for (let ply = 2; ply <= 12; ply += 1) {
    const result = search(board, player, { maxDepth: 4, timeBudgetMs: 3000 });
    const { move } = result;
    board = placeMove(board, move.row, move.col, player);
    console.log(
      `move ${ply}: ${SYMBOLS[player]} plays ${move.row},${move.col} (search score ${result.score})`,
    );
    if (checkCaroWin(board, move.row, move.col, player)) {
      console.log(`\n>>> ${SYMBOLS[player]} WINS <<<\n`);
      printBoard(board, 6, 16, 6, 17);
      return;
    }
    player = player === 1 ? 2 : 1;
  }
  console.log("\n(no win within 12 plies)\n");
  printBoard(board, 6, 16, 6, 17);
}

// The offense move the snapshot ranks #1 — leads to a forced O win.
playout({ row: 9, col: 9 });
// What search() actually chooses on this board — the block survives.
playout({ row: 14, col: 12 });
