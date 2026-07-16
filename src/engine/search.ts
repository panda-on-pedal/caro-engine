import { isLegalMove, placeMove, type Board, type Player } from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { evaluate, WIN_SCORE } from "./evaluate.ts";
import type { Move } from "./state.ts";

const CANDIDATE_RADIUS = 2;

export function findCandidateMoves(board: Board): Move[] {
  const candidates = new Map<string, Move>();
  let hasStone = false;

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] === 0) {
        continue;
      }
      hasStone = true;
      for (let dRow = -CANDIDATE_RADIUS; dRow <= CANDIDATE_RADIUS; dRow += 1) {
        for (
          let dCol = -CANDIDATE_RADIUS;
          dCol <= CANDIDATE_RADIUS;
          dCol += 1
        ) {
          const r = row + dRow;
          const c = col + dCol;
          if (isLegalMove(board, r, c)) {
            candidates.set(`${r},${c}`, { row: r, col: c });
          }
        }
      }
    }
  }

  if (!hasStone) {
    const center = Math.floor(board.length / 2);
    return [{ row: center, col: center }];
  }

  return [...candidates.values()];
}

interface SearchNode {
  score: number;
  principalVariation: Move[];
}

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

function negamax(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
): SearchNode {
  if (depth === 0) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  const moves = findCandidateMoves(board);
  if (moves.length === 0) {
    return { score: 0, principalVariation: [] };
  }

  let best: SearchNode = { score: -Infinity, principalVariation: [] };
  let currentAlpha = alpha;

  for (const move of moves) {
    const next = placeMove(board, move.row, move.col, player);
    const isWin = checkCaroWin(next, move.row, move.col, player);

    const node: SearchNode = isWin
      ? { score: WIN_SCORE + depth, principalVariation: [] }
      : (() => {
          const child = negamax(
            next,
            otherPlayer(player),
            depth - 1,
            -beta,
            -currentAlpha,
          );
          return {
            score: -child.score,
            principalVariation: child.principalVariation,
          };
        })();

    if (node.score > best.score) {
      best = {
        score: node.score,
        principalVariation: [move, ...node.principalVariation],
      };
    }
    currentAlpha = Math.max(currentAlpha, node.score);
    if (currentAlpha >= beta) {
      break;
    }
  }

  return best;
}

export function negamaxSearch(
  board: Board,
  player: Player,
  depth: number,
): SearchNode {
  return negamax(board, player, depth, -Infinity, Infinity);
}
