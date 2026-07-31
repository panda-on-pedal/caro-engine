import { type Board, type Player, isLegalMove } from "../board.ts";
import { checkCaroWin } from "../rules.ts";
import { findPatterns } from "../patterns/patterns.ts";
import { PatternStore } from "../patterns/patternStore.ts";
import type { Move } from "../state.ts";
import { logger } from "../../utils/logger.ts";
import { logMoveKey } from "./logMove.ts";

/** Only threes: playing a gain creates a four (two-gains only make threes). */
const SEED_PATTERN_TYPES = new Set(["three", "open-three"]);
const MAX_SEEDS = 24;

export interface ThreatProbeConfig {
  /** Root moves already covered by normal narrowing — skip re-checking. */
  excludeMoves?: readonly Move[];
  maxSeeds?: number;
  /** Optional deadline; discovery stops early when exceeded. */
  deadlineMs?: number;
  /** Reuse an existing store (place/undo); otherwise built from `board`. */
  store?: PatternStore;
}

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

function moveKey(move: Move): string {
  return `${move.row},${move.col}`;
}

/** Empty cells on opponent three / open-three gains (full set, not top-K). */
export function collectThreatSeeds(
  board: Board,
  defender: Player,
  excludeMoves: ReadonlySet<string> = new Set(),
  store?: PatternStore
): Move[] {
  const attacker = otherPlayer(defender);
  const patternList = store ? store.patterns(attacker) : findPatterns(board, attacker);
  const seeds: Move[] = [];
  const seen = new Set<string>();
  for (const pattern of patternList) {
    if (!SEED_PATTERN_TYPES.has(pattern.type)) {
      continue;
    }
    for (const gain of pattern.gains) {
      const key = moveKey(gain);
      if (excludeMoves.has(key) || seen.has(key)) {
        continue;
      }
      if (!isLegalMove(board, gain.row, gain.col)) {
        continue;
      }
      seen.add(key);
      seeds.push(gain);
    }
  }
  return seeds;
}

/** True when `attacker` has a four/open-four gain that wins on the next ply. */
function hasImmediateWinStore(store: PatternStore, attacker: Player): boolean {
  for (const pattern of store.patterns(attacker)) {
    if (pattern.type !== "four" && pattern.type !== "open-four") {
      continue;
    }
    for (const gain of pattern.gains) {
      if (store.board[gain.row][gain.col] !== 0) {
        continue;
      }
      store.place(gain, attacker);
      const won = checkCaroWin(store.board, gain.row, gain.col, attacker);
      store.undo();
      if (won) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Empty cells where opponent-to-play-there creates an immediate four /
 * open-four (or wins on the spot). Defense-only: returned moves are
 * prophylactic blocks for `defender` — cells crowded out of narrow top-K
 * that still start a forcing line (catalog #20's 13,6).
 */
export function discoverOpponentThreatBlocks(
  board: Board,
  defender: Player,
  config: ThreatProbeConfig = {}
): Move[] {
  const exclude = new Set((config.excludeMoves ?? []).map(moveKey));
  const maxSeeds = config.maxSeeds ?? MAX_SEEDS;
  const deadline = config.deadlineMs;
  const attacker = otherPlayer(defender);
  const store = config.store ?? PatternStore.fromBoard(board);

  const seeds = collectThreatSeeds(store.board, defender, exclude, store).slice(0, maxSeeds);
  logger.log("[threat] seeds", seeds.map(logMoveKey));

  const blocks: Move[] = [];
  for (const seed of seeds) {
    if (deadline !== undefined && Date.now() > deadline) {
      break;
    }
    store.place(seed, attacker);
    if (checkCaroWin(store.board, seed.row, seed.col, attacker)) {
      store.undo();
      blocks.push(seed);
      continue;
    }
    const threatens = hasImmediateWinStore(store, attacker);
    store.undo();
    if (threatens) {
      blocks.push(seed);
    }
  }
  return blocks;
}

/** Prepend threat blocks that are not already in `rootMoves`. */
export function mergeThreatBlocksIntoRoot(rootMoves: Move[], blocks: readonly Move[]): Move[] {
  if (blocks.length === 0) {
    return rootMoves;
  }
  const seen = new Set(rootMoves.map(moveKey));
  const extra: Move[] = [];
  for (const block of blocks) {
    const key = moveKey(block);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    extra.push(block);
  }
  if (extra.length === 0) {
    return rootMoves;
  }
  return [...extra, ...rootMoves];
}
