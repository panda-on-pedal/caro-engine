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
import { logger } from "../utils/logger.ts";
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

/** "Root -> O(7,12) -> X(9,9) -> O(...)" — the alternating turn-by-turn
 * line a root candidate's principalVariation represents, for logging.
 * `moves` starts with the root candidate itself, played by
 * `startPlayer`; every following move alternates player. */
function formatLine(startPlayer: Player, moves: Move[]): string {
  let mover = startPlayer;
  const segments = moves.map((move) => {
    const label = mover === 1 ? "X" : "O";
    mover = otherPlayer(mover);
    return `${label}(${move.row},${move.col})`;
  });
  return ["Root", ...segments].join(" -> ");
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
  rootJitter?: (score: number) => number,
  // `path`/`rootPlayer` exist purely for the "[search] node visited" log
  // below: `path` is every move played so far to reach `board` (empty at
  // the true root of a depth iteration), and `rootPlayer` is who played
  // path[0], fixed for the whole tree, so formatLine can label every
  // move in the path correctly regardless of how deep this call is.
  path: Move[] = [],
  rootPlayer: Player = player,
): SearchNode {
  nodeCounter.count += 1;
  logger.log("[search] node visited", {
    node: nodeCounter.count,
    depth,
    toMove: player === 1 ? "X" : "O",
    path: formatLine(rootPlayer, path),
  });

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
  const moves =
    rootMoves ??
    narrowCandidates(board, player, moveCount, narrowConfig).moves;
  if (moves.length === 0) {
    return { score: 0, principalVariation: [] };
  }

  let best: SearchNode = { score: -Infinity, principalVariation: [] };
  // Best-move selection can be jittered (root only); alpha-beta and the
  // reported score always use true scores, so pruning stays sound and
  // callers see the chosen move's real evaluation.
  let bestCompare = -Infinity;
  let currentAlpha = alpha;

  // `rootMoves !== undefined` marks this as the actual root frame (see
  // the comment above) — only there do we log per-candidate examination,
  // since that's the frame whose move ultimately gets played, and the
  // only frame where "did the deadline cut this short" matters for
  // debugging (child frames start with beta === Infinity too, but their
  // alpha-beta cutoffs are expected pruning, not a partial-search risk).
  const isRootFrame = rootMoves !== undefined;
  if (isRootFrame) {
    logger.log("[search] root: examining candidates", {
      depth,
      count: moves.length,
      moves: moves.map((m) => `${m.row},${m.col}`),
    });
  }

  let examinedCount = 0;
  for (const move of moves) {
    if (deadline !== null && Date.now() > deadline) {
      if (isRootFrame) {
        logger.log("[search] root: deadline hit — stopped early", {
          depth,
          examined: examinedCount,
          total: moves.length,
          unexamined: moves
            .slice(examinedCount)
            .map((m) => `${m.row},${m.col}`),
        });
      }
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
            undefined,
            undefined,
            [...path, move],
            rootPlayer,
          );
          return {
            score: -child.score,
            principalVariation: child.principalVariation,
          };
        })();
    examinedCount += 1;

    const compareScore = rootJitter ? rootJitter(node.score) : node.score;
    if (isRootFrame) {
      logger.log("[search] root: candidate examined", {
        depth,
        move: `${move.row},${move.col}`,
        score: node.score,
        comparedScore: compareScore,
        isWin,
        // The turn-by-turn continuation this candidate's score is based
        // on — empty beyond the move itself whenever the recursive call
        // bottomed out at a depth-0 static evaluate() with no further
        // moves simulated (always true one ply before the deepest depth
        // reached this iteration).
        line: formatLine(player, [move, ...node.principalVariation]),
      });
    }
    if (compareScore > bestCompare) {
      bestCompare = compareScore;
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
  if (isRootFrame && examinedCount === moves.length) {
    logger.log("[search] root: examined all candidates", {
      depth,
      count: examinedCount,
      bestMove: best.principalVariation[0]
        ? `${best.principalVariation[0].row},${best.principalVariation[0].col}`
        : null,
      bestScore: best.score,
      bestLine: formatLine(player, best.principalVariation),
    });
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
    rng: config.rng,
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
  /**
   * Fraction (e.g. 0.1 = ±10%) by which each ROOT candidate's final
   * search score is randomly perturbed before the best-move comparison,
   * so near-equal candidates (say 200 vs 190) become interchangeable and
   * the engine feels dynamic instead of replaying the identical move in
   * identical positions. Applied only at the root and only to the move
   * choice — alpha-beta pruning and the reported score use true scores,
   * and forced win/loss scores (|score| >= WIN_SCORE) are never
   * perturbed. Default 0 (off).
   */
  rootScoreJitter?: number;
  /** Random stream for jitter and quiet-move sampling. Defaults to
   * Math.random; inject a seeded stream for deterministic tests. */
  rng?: () => number;
}

/**
 * `score * (1 ± fraction)`, sign-preserving, using one `rng` draw.
 * Forced outcomes (|score| >= WIN_SCORE) pass through untouched — jitter
 * must never flip a known win/loss into anything else.
 */
export function jitteredScore(
  score: number,
  fraction: number,
  rng: () => number,
): number {
  if (fraction <= 0 || Math.abs(score) >= WIN_SCORE) {
    return score;
  }
  return score * (1 + (rng() * 2 - 1) * fraction);
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
  const jitterFraction = config.rootScoreJitter ?? 0;
  const rng = config.rng ?? Math.random;
  const rootJitter =
    jitterFraction > 0
      ? (score: number) => jitteredScore(score, jitterFraction, rng)
      : undefined;

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
      rootJitter,
    );
    if (result.principalVariation.length === 0) {
      break;
    }
    // This depth's result becomes the strategy's answer unconditionally
    // (even if the deadline cut the root loop short mid-way through this
    // depth — see "[search] root: deadline hit" above) — a still-partial
    // depth D result silently overwrites the fully-examined depth D-1
    // answer that came before it. Logged here so that can be spotted:
    // compare this depth's chosen move/score against whether the
    // matching "examined all candidates" log fired for the same depth.
    logger.log("[search] depth iteration complete", {
      depth,
      chosenMove: result.principalVariation[0]
        ? `${result.principalVariation[0].row},${result.principalVariation[0].col}`
        : null,
      chosenLine: formatLine(player, result.principalVariation),
      score: result.score,
      nodesVisitedSoFar: nodeCounter.count,
    });
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
  strategy?: MoveSelectionStrategy,
): SearchResult {
  const narrowConfig = resolveNarrowConfig(config);
  const moveCount = countStones(board);
  const narrowed = narrowCandidates(board, player, moveCount, narrowConfig);

  if (narrowed.moves.length === 0) {
    const fallbackMoves = findCandidateMoves(board);
    return {
      move: fallbackMoves[0],
      score: 0,
      depth: 0,
      principalVariation: [],
      nodesVisited: 0,
    };
  }

  // A single candidate (any source — forced, a lone tactical fork point
  // like catalog #7/#9, or quiet) has nothing to compare against: play it
  // directly instead of paying for a negamax search whose root loop would
  // only ever visit one move anyway.
  const resolvedStrategy =
    strategy ??
    (narrowed.moves.length === 1 || narrowed.source === "quiet"
      ? patternOnlyStrategy
      : negamaxStrategy);

  // Debug: root (depth-1) candidate set and search order.
  logger.log("[search] root candidates", {
    player,
    moveCount,
    source: narrowed.source,
    strategy:
      resolvedStrategy === patternOnlyStrategy
        ? "patternOnly"
        : resolvedStrategy === negamaxStrategy
          ? "negamax"
          : "custom",
    count: narrowed.moves.length,
    moves: narrowed.moves.map((m) => `${m.row},${m.col}`),
  });

  return resolvedStrategy(board, player, narrowed.moves, config);
}
