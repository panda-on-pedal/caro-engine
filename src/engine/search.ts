// src/engine/search.ts
import { type Board, type Player } from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import { evaluateFromPatterns, WIN_SCORE } from "./evaluate.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  findCandidateMoves,
  narrowCandidates,
  recognizedForkPoints,
  type ForkPatternName,
  type NarrowConfig,
} from "./narrow.ts";
import { PatternStore } from "./patternStore.ts";
import type { DecayConfig } from "./randomize.ts";
import {
  ProgressReporter,
  type InsightKind,
  type SearchProgressEvent,
} from "./searchProgress.ts";
import { logger } from "../utils/logger.ts";
import type { Move } from "./state.ts";
import {
  experienceBeatsBaseline,
  isUsableExperienceMove,
  type ExperienceEntry,
  type ExperienceMode,
} from "./experience.ts";
import { resolveEffectiveTimeBudget } from "./timeBudget.ts";

export type { InsightKind, SearchProgressEvent } from "./searchProgress.ts";

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

function moveKey(move: Move): string {
  return `${move.row},${move.col}`;
}

/** Cheap root-only insight from patterns / forced-block set. */
function classifyRootInsight(params: {
  store: PatternStore;
  player: Player;
  move: Move;
  isWin: boolean;
  blockKeys: ReadonlySet<string>;
  forkKeys: ReadonlySet<string>;
}): InsightKind | null {
  if (params.isWin) {
    return "win";
  }
  const key = moveKey(params.move);
  const involving = params.store
    .patterns(params.player)
    .filter((pattern) =>
      pattern.cells.some(
        (cell) => cell.row === params.move.row && cell.col === params.move.col,
      ),
    );
  if (involving.some((pattern) => pattern.type === "open-four")) {
    return "open-four";
  }
  if (involving.some((pattern) => pattern.type === "four")) {
    return "four";
  }
  if (params.forkKeys.has(key)) {
    return "fork";
  }
  if (involving.some((pattern) => pattern.type === "open-three")) {
    return "open-three";
  }
  if (params.blockKeys.has(key)) {
    return "block";
  }
  return null;
}

interface RootProgress {
  report: ProgressReporter;
  blockKeys: ReadonlySet<string>;
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
  rootProgress?: RootProgress,
): SearchNode {
  nodeCounter.count += 1;

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

  const forkKeys =
    isRootFrame && rootProgress
      ? new Set(
          recognizedForkPoints(
            store.patterns(player),
            narrowConfig.recognizedForkPatterns,
          ).map((forkPoint) => moveKey(forkPoint.move)),
        )
      : null;

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

    if (isRootFrame && rootProgress) {
      rootProgress.report.emit({
        type: "examining",
        row: move.row,
        col: move.col,
      });
    }

    store.place(move, player);
    const isWin = checkCaroWin(store.board, move.row, move.col, player);

    if (isRootFrame && rootProgress && forkKeys) {
      const kind = classifyRootInsight({
        store,
        player,
        move,
        isWin,
        blockKeys: rootProgress.blockKeys,
        forkKeys,
      });
      if (kind) {
        rootProgress.report.emit({
          type: "insight",
          row: move.row,
          col: move.col,
          kind,
        });
      }
    }

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
    if (compareScore > bestCompare) {
      bestCompare = compareScore;
      best = {
        score: node.score,
        principalVariation: [move, ...node.principalVariation],
      };
      if (isRootFrame && rootProgress) {
        rootProgress.report.emit({
          type: "bestSoFar",
          row: move.row,
          col: move.col,
        });
      }
    }
    currentAlpha = Math.max(currentAlpha, node.score);
    if (currentAlpha >= beta) {
      break;
    }
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
  /**
   * When false, skip own-stone time stepping (practice / background reinvest).
   * Default true.
   */
  stepTimeByOwnStones?: boolean;
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
  /** Optional structured progress sink (UI narration). */
  onProgress?: (event: SearchProgressEvent) => void;
  /** Root moves that are forced blocks — used for insight.kind === "block". */
  progressBlockKeys?: ReadonlySet<string>;
  /** Root experience policy for this call. Default: off inside search. */
  experienceMode?: ExperienceMode;
  /** Practice baseline (and optional move-ordering seed). */
  experienceBaseline?: ExperienceEntry;
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

  const report = new ProgressReporter(config.onProgress);
  const rootProgress: RootProgress = {
    report,
    blockKeys: config.progressBlockKeys ?? new Set(),
  };

  let bestNode: SearchNode | null = null;
  let depthReached = 0;

  for (let depth = 1; depth <= config.maxDepth; depth += 1) {
    if (deadline !== null && Date.now() > deadline) {
      break;
    }
    report.emit({ type: "deeper", depth });
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
      [],
      player,
      rootProgress,
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

function seedBaselineMove(moves: Move[], baseline: Move | undefined): Move[] {
  if (baseline === undefined) {
    return moves;
  }
  const key = moveKey(baseline);
  const rest: Move[] = [];
  for (const move of moves) {
    if (moveKey(move) !== key) {
      rest.push(move);
    }
  }
  return [baseline, ...rest];
}

function applyExperienceBaseline(
  result: SearchResult,
  config: SearchConfig,
  board: Board,
): SearchResult {
  if (config.experienceMode === "off" || config.experienceMode === undefined) {
    return result;
  }
  const baseline = config.experienceBaseline;
  if (!isUsableExperienceMove(board, baseline)) {
    return result;
  }
  const candidate: ExperienceEntry = {
    move: result.move,
    score: result.score,
    depth: result.depth,
  };
  if (experienceBeatsBaseline(candidate, baseline)) {
    return result;
  }
  return {
    move: baseline.move,
    score: baseline.score,
    depth: baseline.depth,
    principalVariation: [baseline.move],
    nodesVisited: result.nodesVisited,
  };
}

export function search(
  board: Board,
  player: Player,
  config: SearchConfig,
  strategy?: MoveSelectionStrategy,
): SearchResult {
  const report = new ProgressReporter(config.onProgress);
  report.emit({ type: "phase", phase: "scanning" });

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
  const effectiveTimeBudgetMs =
    config.timeBudgetMs !== undefined
      ? resolveEffectiveTimeBudget({
          maxBudgetMs: config.timeBudgetMs,
          moveCount,
          stepTimeByOwnStones: config.stepTimeByOwnStones,
        })
      : config.timeBudgetMs;

  if (narrowed.moves.length === 0) {
    const fallbackMoves = findCandidateMoves(store.board);
    report.emit({ type: "phase", phase: "quiet" });
    return applyExperienceBaseline(
      {
        move: fallbackMoves[0],
        score: 0,
        depth: 0,
        principalVariation: [],
        nodesVisited: 0,
      },
      config,
      store.board,
    );
  }

  const baselineMove =
    config.experienceMode !== undefined &&
    config.experienceMode !== "off" &&
    isUsableExperienceMove(store.board, config.experienceBaseline)
      ? config.experienceBaseline.move
      : undefined;
  const rootMoves = seedBaselineMove(narrowed.moves, baselineMove);

  const isQuietPath =
    rootMoves.length === 1 || narrowed.source === "quiet";
  report.emit({
    type: "candidates",
    count: rootMoves.length,
    source: narrowed.source,
  });
  report.emit({
    type: "phase",
    phase: isQuietPath ? "quiet" : "searching",
  });

  const progressBlockKeys =
    narrowed.source === "forced"
      ? new Set(rootMoves.map(moveKey))
      : undefined;

  const searchConfig: SearchConfig = {
    ...config,
    timeBudgetMs: effectiveTimeBudgetMs,
    patternStore: store,
    progressBlockKeys,
  };

  const resolvedStrategy =
    strategy ??
    (isQuietPath ? patternOnlyStrategy : negamaxStrategy);

  logger.log("[search] root candidates", {
    player,
    moveCount,
    source: narrowed.source,
    effectiveTimeBudgetMs,
    strategy:
      resolvedStrategy === patternOnlyStrategy
        ? "patternOnly"
        : resolvedStrategy === negamaxStrategy
          ? "negamax"
          : "custom",
    count: rootMoves.length,
    moves: rootMoves.map((m) => `${m.row},${m.col}`),
  });

  const result = resolvedStrategy(
    store.board,
    player,
    rootMoves,
    searchConfig,
  );
  return applyExperienceBaseline(result, config, store.board);
}
