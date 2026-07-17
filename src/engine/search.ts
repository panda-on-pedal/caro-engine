// src/engine/search.ts
import { placeMove, type Board, type Player } from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { evaluate, WIN_SCORE } from "./evaluate.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  findCandidateMoves,
  narrowCandidates,
  type ForkPatternName,
  type NarrowConfig,
} from "./narrow.ts";
import type { DecayConfig } from "./randomize.ts";
import type { Move } from "./state.ts";

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  startDecay: 0.8,
  minDecay: 0.15,
  stepDown: 0.05,
};

interface SearchNode {
  score: number;
  principalVariation: Move[];
}

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
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
  moveCount: number,
  narrowConfig: NarrowConfig,
  rootMoves?: Move[],
): SearchNode {
  nodeCounter.count += 1;

  if (depth === 0) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  // Check before paying for narrowCandidates' pattern computation — see
  // the deadline-precision note this comment replaces below.
  if (deadline !== null && Date.now() > deadline) {
    return { score: evaluate(board, player), principalVariation: [] };
  }

  // `rootMoves`, when provided, is the exact pre-narrowed candidate set a
  // MoveSelectionStrategy (Task 8) already computed once via
  // narrowCandidates before invoking this search — reusing it here (rather
  // than recomputing) avoids both duplicating this loop in the strategy
  // and silently re-rolling narrowCandidates' weighted-random reordering
  // into a different order than what the strategy actually received.
  // Every recursive call omits it, so deeper plies compute their own
  // candidates as normal.
  const moves = rootMoves ?? narrowCandidates(board, player, moveCount, narrowConfig);
  if (moves.length === 0) {
    return { score: 0, principalVariation: [] };
  }

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
            moveCount + 1,
            narrowConfig,
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

function resolveNarrowConfig(config: SearchConfig): NarrowConfig {
  return {
    recognizedForkPatterns:
      config.recognizedForkPatterns ?? ALL_FORK_PATTERN_NAMES,
    decay: config.decay ?? DEFAULT_DECAY_CONFIG,
  };
}

function countStones(board: Board): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell !== 0) {
        count += 1;
      }
    }
  }
  return count;
}

export function negamaxSearch(
  board: Board,
  player: Player,
  depth: number,
): SearchNode {
  const narrowConfig: NarrowConfig = {
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    decay: DEFAULT_DECAY_CONFIG,
  };
  return negamax(
    board,
    player,
    depth,
    -Infinity,
    Infinity,
    null,
    { count: 0 },
    countStones(board),
    narrowConfig,
  );
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
  recognizedForkPatterns?: ReadonlySet<ForkPatternName>;
  decay?: DecayConfig;
}

export type MoveSelectionStrategy = (
  board: Board,
  player: Player,
  candidates: Move[],
  config: SearchConfig,
) => SearchResult;

export const negamaxStrategy: MoveSelectionStrategy = (
  board,
  player,
  candidates,
  config,
) => {
  const deadline =
    config.timeBudgetMs !== undefined
      ? Date.now() + config.timeBudgetMs
      : null;
  const nodeCounter: NodeCounter = { count: 0 };
  const narrowConfig = resolveNarrowConfig(config);
  const moveCount = countStones(board);

  let bestNode: SearchNode | null = null;
  let depthReached = 0;

  for (let depth = 1; depth <= config.maxDepth; depth += 1) {
    if (deadline !== null && Date.now() > deadline) {
      break;
    }
    // Reuse negamax's existing loop/pruning logic rather than
    // reimplementing it here — `candidates` (the exact pre-narrowed set
    // `search()` computed once) is threaded through as `rootMoves`, so
    // this call searches precisely those moves instead of recomputing
    // (and potentially re-rolling a different weighted-random order for)
    // its own candidate set. Deeper recursive calls inside `negamax` omit
    // `rootMoves` and narrow normally at every subsequent node.
    const result = negamax(
      board,
      player,
      depth,
      -Infinity,
      Infinity,
      deadline,
      nodeCounter,
      moveCount,
      narrowConfig,
      candidates,
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
    return {
      move: candidates[0],
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
};

/** Zero-lookahead: takes narrowing's top candidate directly, with no
 * verification search. For testing narrowCandidates in isolation and as
 * a template for future alternative strategies. */
export const patternOnlyStrategy: MoveSelectionStrategy = (
  _board,
  _player,
  candidates,
) => ({
  move: candidates[0],
  score: 0,
  depth: 0,
  principalVariation: [candidates[0]],
  nodesVisited: 0,
});

export function search(
  board: Board,
  player: Player,
  config: SearchConfig,
  strategy: MoveSelectionStrategy = negamaxStrategy,
): SearchResult {
  const narrowConfig = resolveNarrowConfig(config);
  const moveCount = countStones(board);
  const candidates = narrowCandidates(board, player, moveCount, narrowConfig);

  if (candidates.length === 0) {
    const fallbackMoves = findCandidateMoves(board);
    return {
      move: fallbackMoves[0],
      score: 0,
      depth: 0,
      principalVariation: [],
      nodesVisited: 0,
    };
  }

  return strategy(board, player, candidates, config);
}
