import { isLegalMove, placeMove, type Board, type Player } from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { evaluate, WIN_SCORE } from "./evaluate.ts";
import {
  findForkPoints,
  findPatterns,
  type PatternInstance,
  type PatternType,
} from "./patterns.ts";
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

function movesGaining(
  patterns: PatternInstance[],
  type: PatternType,
  key: string,
): boolean {
  return patterns.some(
    (p) => p.type === type && p.gains.some((g) => `${g.row},${g.col}` === key),
  );
}

export function orderMoves(
  moves: Move[],
  ownPatterns: PatternInstance[],
  oppPatterns: PatternInstance[],
  forkPoints: ReadonlySet<string>,
): Move[] {
  const scoreOf = (move: Move): number => {
    const key = `${move.row},${move.col}`;

    if (
      movesGaining(ownPatterns, "four", key) ||
      movesGaining(ownPatterns, "open-four", key)
    ) {
      return 5;
    }
    if (
      movesGaining(oppPatterns, "four", key) ||
      movesGaining(oppPatterns, "open-four", key)
    ) {
      return 4;
    }
    if (forkPoints.has(key)) {
      return 3;
    }
    if (movesGaining(ownPatterns, "open-three", key)) {
      return 2;
    }
    return 1;
  };

  return [...moves].sort((a, b) => scoreOf(b) - scoreOf(a));
}

interface NodeCounter {
  count: number;
}

function negamax(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
  deadline: number | null,
  nodeCounter: NodeCounter,
): SearchNode {
  nodeCounter.count += 1;

  if (depth === 0) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  // Check before paying for findCandidateMoves/findPatterns/findForkPoints —
  // those are expensive per node, so checking only inside the move loop
  // below lets an already-expired deadline still pay for one full node's
  // pattern computation before noticing. This bounds the overrun to
  // whatever's already in flight, not an entire subtree.
  if (deadline !== null && Date.now() > deadline) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  const rawMoves = findCandidateMoves(board);
  if (rawMoves.length === 0) {
    return { score: 0, principalVariation: [] };
  }

  const ownPatterns = findPatterns(board, player);
  const oppPatterns = findPatterns(board, otherPlayer(player));
  const forkPoints = new Set(
    findForkPoints(ownPatterns).map((f) => `${f.move.row},${f.move.col}`),
  );
  const moves = orderMoves(rawMoves, ownPatterns, oppPatterns, forkPoints);

  let best: SearchNode = { score: -Infinity, principalVariation: [] };
  let currentAlpha = alpha;

  for (const move of moves) {
    if (deadline !== null && Date.now() > deadline) {
      break;
    }

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
            deadline,
            nodeCounter,
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

  // If the deadline fired before any move in this node was evaluated,
  // `best` is still the -Infinity sentinel. A parent frame negates a
  // child's score (`-child.score`) to fold it into its own comparison,
  // which would turn an un-evaluated -Infinity into a bogus +Infinity —
  // a false "forced win" signal. Fall back to a finite static evaluation
  // instead, matching what a depth-0 leaf would report.
  if (best.score === -Infinity) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  return best;
}

export function negamaxSearch(
  board: Board,
  player: Player,
  depth: number,
): SearchNode {
  return negamax(board, player, depth, -Infinity, Infinity, null, {
    count: 0,
  });
}

export interface SearchResult {
  move: Move;
  score: number;
  depth: number;
  principalVariation: Move[];
  nodesVisited: number;
}

export interface SearchConfig {
  maxDepth: number;
  timeBudgetMs?: number;
}

export function search(
  board: Board,
  player: Player,
  config: SearchConfig,
): SearchResult {
  const deadline =
    config.timeBudgetMs !== undefined
      ? Date.now() + config.timeBudgetMs
      : null;
  const nodeCounter: NodeCounter = { count: 0 };

  let bestNode: SearchNode | null = null;
  let depthReached = 0;

  for (let depth = 1; depth <= config.maxDepth; depth += 1) {
    if (deadline !== null && Date.now() > deadline) {
      break;
    }
    const result = negamax(
      board,
      player,
      depth,
      -Infinity,
      Infinity,
      deadline,
      nodeCounter,
    );
    if (result.principalVariation.length === 0) {
      break;
    }
    bestNode = result;
    depthReached = depth;
    if (Math.abs(result.score) >= WIN_SCORE) {
      break;
    }
  }

  if (bestNode === null) {
    const fallbackMoves = findCandidateMoves(board);
    return {
      move: fallbackMoves[0],
      score: 0,
      depth: 0,
      principalVariation: [],
      nodesVisited: nodeCounter.count,
    };
  }

  return {
    move: bestNode.principalVariation[0],
    score: bestNode.score,
    depth: depthReached,
    principalVariation: bestNode.principalVariation,
    nodesVisited: nodeCounter.count,
  };
}
