// src/engine/rankMoves.ts
import { placeMove, type Board, type Player } from "../board.ts";
import { checkCaroWin } from "../rules.ts";
import { findPatterns, type PatternInstance } from "../patterns/patterns.ts";
import { RANK_PATTERN_WEIGHTS } from "./evaluate.ts";
import type { PatternStore } from "../patterns/patternStore.ts";
import type { Move } from "../state.ts";

export const DEFAULT_TOP_K = 5;

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

/** Sum of `RANK_PATTERN_WEIGHTS` over instances (no tempo multiplier). */
export function totalPatternScore(patterns: readonly PatternInstance[]): number {
  let total = 0;
  for (const p of patterns) {
    total += RANK_PATTERN_WEIGHTS[p.type];
  }
  return total;
}

/**
 * `ownDelta + oppDelta` after playing `move` as `player`, given pattern
 * totals already computed on the pre-move board. Shared by `scoreMove` and
 * `selectTopMoves` so scoring many candidates from the same position only
 * pays for the "before" `findPatterns` scan once.
 */
function scoreMoveFromBaseline(
  board: Board,
  player: Player,
  opponent: Player,
  ownBefore: number,
  oppBefore: number,
  move: Move
): number {
  const next = placeMove(board, move.row, move.col, player);
  if (checkCaroWin(next, move.row, move.col, player)) {
    return Number.POSITIVE_INFINITY;
  }
  const ownAfter = totalPatternScore(findPatterns(next, player));
  const oppAfter = totalPatternScore(findPatterns(next, opponent));
  return ownAfter - ownBefore + (oppBefore - oppAfter);
}

function scoreMoveFromStore(
  store: PatternStore,
  player: Player,
  opponent: Player,
  ownBefore: number,
  oppBefore: number,
  move: Move
): number {
  store.place(move, player);
  let score: number;
  if (checkCaroWin(store.board, move.row, move.col, player)) {
    score = Number.POSITIVE_INFINITY;
  } else {
    const ownAfter = totalPatternScore(store.patterns(player));
    const oppAfter = totalPatternScore(store.patterns(opponent));
    score = ownAfter - ownBefore + (oppBefore - oppAfter);
  }
  store.undo();
  return score;
}

/**
 * Own pattern-score gain plus opponent pattern-score reduction from playing
 * `move` as `player`. An immediate win scores `+Infinity` so it always
 * ranks first.
 */
export function scoreMove(board: Board, player: Player, move: Move): number {
  const opponent = otherPlayer(player);
  const ownBefore = totalPatternScore(findPatterns(board, player));
  const oppBefore = totalPatternScore(findPatterns(board, opponent));
  return scoreMoveFromBaseline(board, player, opponent, ownBefore, oppBefore, move);
}

function bonusFor(bonus: ReadonlyMap<string, number> | undefined, move: Move): number {
  return bonus?.get(`${move.row},${move.col}`) ?? 0;
}

function rankByScore(
  board: Board,
  player: Player,
  opponent: Player,
  ownBefore: number,
  oppBefore: number,
  moves: readonly Move[],
  bonus?: ReadonlyMap<string, number>
): Move[] {
  const ranked = moves.map((move, index) => ({
    move,
    index,
    score:
      scoreMoveFromBaseline(board, player, opponent, ownBefore, oppBefore, move) +
      bonusFor(bonus, move),
  }));
  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });
  return ranked.map(r => r.move);
}

function rankByScoreFromStore(
  store: PatternStore,
  player: Player,
  opponent: Player,
  ownBefore: number,
  oppBefore: number,
  moves: readonly Move[],
  bonus?: ReadonlyMap<string, number>
): Move[] {
  const ranked = moves.map((move, index) => ({
    move,
    index,
    score:
      scoreMoveFromStore(store, player, opponent, ownBefore, oppBefore, move) +
      bonusFor(bonus, move),
  }));
  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });
  return ranked.map(r => r.move);
}

/**
 * Stable sort of `moves` by `scoreMove` descending, returning the first
 * `k`. Ties keep their relative input order.
 */
export function selectTopMoves(
  board: Board,
  player: Player,
  moves: readonly Move[],
  k: number = DEFAULT_TOP_K
): Move[] {
  const opponent = otherPlayer(player);
  const ownBefore = totalPatternScore(findPatterns(board, player));
  const oppBefore = totalPatternScore(findPatterns(board, opponent));
  return rankByScore(board, player, opponent, ownBefore, oppBefore, moves).slice(0, k);
}

/** Like `selectTopMoves`, scoring trial places via `PatternStore`. */
export function selectTopMovesFromStore(
  store: PatternStore,
  player: Player,
  moves: readonly Move[],
  k: number = DEFAULT_TOP_K
): Move[] {
  const opponent = otherPlayer(player);
  const ownBefore = totalPatternScore(store.patterns(player));
  const oppBefore = totalPatternScore(store.patterns(opponent));
  return rankByScoreFromStore(store, player, opponent, ownBefore, oppBefore, moves).slice(0, k);
}

/**
 * Tier-ordered variant of `selectTopMoves`: every move from an earlier
 * tier ranks ahead of all moves from later tiers regardless of score, so
 * a high-scoring soft/offensive gain can never crowd an urgent
 * threat-answering move out of the top `k`. Within a tier, moves sort by
 * `scoreMove` descending (stable on ties). A cell appearing in several
 * tiers keeps its earliest-tier slot.
 */
export function selectTopMovesTiered(
  board: Board,
  player: Player,
  tiers: ReadonlyArray<readonly Move[]>,
  k: number = DEFAULT_TOP_K,
  bonus?: ReadonlyMap<string, number>
): Move[] {
  const opponent = otherPlayer(player);
  const ownBefore = totalPatternScore(findPatterns(board, player));
  const oppBefore = totalPatternScore(findPatterns(board, opponent));

  const seen = new Set<string>();
  const selected: Move[] = [];
  for (const tier of tiers) {
    if (selected.length >= k) {
      break;
    }
    const fresh = tier.filter(move => {
      const key = `${move.row},${move.col}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    for (const move of rankByScore(board, player, opponent, ownBefore, oppBefore, fresh, bonus)) {
      if (selected.length >= k) {
        break;
      }
      selected.push(move);
    }
  }
  return selected;
}

/** Like `selectTopMovesTiered`, scoring trial places via `PatternStore`. */
export function selectTopMovesTieredFromStore(
  store: PatternStore,
  player: Player,
  tiers: ReadonlyArray<readonly Move[]>,
  k: number = DEFAULT_TOP_K,
  bonus?: ReadonlyMap<string, number>
): Move[] {
  const opponent = otherPlayer(player);
  const ownBefore = totalPatternScore(store.patterns(player));
  const oppBefore = totalPatternScore(store.patterns(opponent));

  const seen = new Set<string>();
  const selected: Move[] = [];
  for (const tier of tiers) {
    if (selected.length >= k) {
      break;
    }
    const fresh = tier.filter(move => {
      const key = `${move.row},${move.col}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    for (const move of rankByScoreFromStore(
      store,
      player,
      opponent,
      ownBefore,
      oppBefore,
      fresh,
      bonus
    )) {
      if (selected.length >= k) {
        break;
      }
      selected.push(move);
    }
  }
  return selected;
}
