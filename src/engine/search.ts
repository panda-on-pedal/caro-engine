// src/engine/search.ts
import { type Board, type Player } from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { evaluateFromPatterns, WIN_SCORE } from "./evaluate.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  findCandidateMoves,
  narrowCandidates,
  type ForkPatternName,
  type NarrowConfig,
} from "./narrow.ts";
import { PatternStore } from "./patternStore.ts";
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
  /** False when the root candidate loop stopped early (deadline). */
  complete?: boolean;
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

function narrowConfigForStore(
  store: PatternStore,
  player: Player,
  base: NarrowConfig,
): NarrowConfig {
  return {
    ...base,
    ownPatterns: store.patterns(player),
    oppPatterns: store.patterns(otherPlayer(player)),
    store,
  };
}

function evaluateStore(store: PatternStore, player: Player): number {
  return evaluateFromPatterns(
    store.patterns(player),
    store.patterns(otherPlayer(player)),
  );
}

function negamax(
  store: PatternStore,
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
    return { score: evaluateStore(store, player), principalVariation: [] };
  }

  if (deadline !== null && Date.now() > deadline) {
    return { score: evaluateStore(store, player), principalVariation: [] };
  }

  const nodeNarrow = narrowConfigForStore(store, player, narrowConfig);
  const moves =
    rootMoves ??
    narrowCandidates(store.board, player, moveCount, nodeNarrow).moves;
  if (moves.length === 0) {
    return { score: 0, principalVariation: [] };
  }

  let best: SearchNode = { score: -Infinity, principalVariation: [] };
  let bestCompare = -Infinity;
  let currentAlpha = alpha;

  const isRootFrame = rootMoves !== undefined;
  if (isRootFrame) {
    logger.log("[search] root: examining candidates", {
      depth,
      count: moves.length,
      moves: moves.map((m) => `${m.row},${m.col}`),
    });
  }

  let examinedCount = 0;
  let rootIncomplete = false;
  for (const move of moves) {
    if (deadline !== null && Date.now() > deadline) {
      if (isRootFrame) {
        rootIncomplete = true;
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

    store.place(move, player);
    const isWin = checkCaroWin(store.board, move.row, move.col, player);

    const node: SearchNode = isWin
      ? { score: WIN_SCORE + depth, principalVariation: [] }
      : (() => {
          const child = negamax(
            store,
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
    store.undo();
    examinedCount += 1;

    const compareScore = rootJitter ? rootJitter(node.score) : node.score;
    if (isRootFrame) {
      logger.log("[search] root: candidate examined", {
        depth,
        move: `${move.row},${move.col}`,
        score: node.score,
        comparedScore: compareScore,
        isWin,
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

  if (best.score === -Infinity) {
    return { score: evaluateStore(store, player), principalVariation: [] };
  }

  if (isRootFrame) {
    best.complete = !rootIncomplete;
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
  const store = PatternStore.fromBoard(board);
  const narrowConfig: NarrowConfig = {
    recognizedForkPatterns: ALL_FORK_PATTERN_NAMES,
    decay: DEFAULT_DECAY_CONFIG,
  };
  return negamax(
    store,
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
  /** Shared pattern cache for this chooseMove/search call. */
  patternStore?: PatternStore;
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
  const store = config.patternStore ?? PatternStore.fromBoard(board);
  const narrowConfig = resolveNarrowConfig(config);
  const moveCount = countStones(store.board);
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
    const result = negamax(
      store,
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
    // Discard a partial deeper iteration when a fully examined shallower
    // depth already exists — a mid-root deadline must not overwrite that
    // with an ordering-biased partial. If this is the first depth and it
    // was cut short, keep the partial best (still better than candidates[0]).
    if (result.complete === false) {
      if (bestNode === null && result.principalVariation.length > 0) {
        bestNode = result;
        depthReached = depth;
        logger.log(
          "[search] depth iteration incomplete — keeping partial first depth",
          {
            depth,
            nodesVisitedSoFar: nodeCounter.count,
          },
        );
      } else {
        logger.log(
          "[search] depth iteration incomplete — keeping prior depth",
          {
            depth,
            priorDepth: depthReached,
            nodesVisitedSoFar: nodeCounter.count,
          },
        );
      }
      break;
    }
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
  const store = config.patternStore ?? PatternStore.fromBoard(board);
  const baseNarrow = resolveNarrowConfig(config);
  const moveCount = countStones(store.board);
  const narrowConfig = narrowConfigForStore(store, player, baseNarrow);
  const narrowed = narrowCandidates(
    store.board,
    player,
    moveCount,
    narrowConfig,
  );

  if (narrowed.moves.length === 0) {
    const fallbackMoves = findCandidateMoves(store.board);
    return {
      move: fallbackMoves[0],
      score: 0,
      depth: 0,
      principalVariation: [],
      nodesVisited: 0,
    };
  }

  const searchConfig: SearchConfig = { ...config, patternStore: store };

  const resolvedStrategy =
    strategy ??
    (narrowed.moves.length === 1 || narrowed.source === "quiet"
      ? patternOnlyStrategy
      : negamaxStrategy);

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

  return resolvedStrategy(store.board, player, narrowed.moves, searchConfig);
}
