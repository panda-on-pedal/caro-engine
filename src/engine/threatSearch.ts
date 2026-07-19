import { type Player } from "./board.ts";
import { checkCaroWin } from "./rules.ts";
import {
  ALL_FORK_PATTERN_NAMES,
  boxCell,
  hasImmediateWin,
  recognizedForkPoints,
  survivingBlocks,
  type ForkPatternName,
} from "./narrow.ts";
import type { PatternStore } from "./patternStore.ts";
import type { Move } from "./state.ts";

export type ForcedWinResult = {
  won: boolean;
  principalVariation: Move[];
  nodesVisited: number;
};

export type ThreatSearchOptions = {
  maxPly: number;
  deadline?: number | null;
  recognizedForkPatterns?: ReadonlySet<ForkPatternName>;
};

function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

function cellKey(move: Move): string {
  return `${move.row},${move.col}`;
}

function dedupeMoves(moves: Move[]): Move[] {
  const seen = new Set<string>();
  const out: Move[] = [];
  for (const move of moves) {
    const key = cellKey(move);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(move);
  }
  return out;
}

function pushUnique(out: Move[], seen: Set<string>, moves: readonly Move[]): void {
  for (const move of moves) {
    const key = cellKey(move);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(move);
  }
}

/**
 * Option-A attacker threat cells, ordered: four/open-four gains →
 * recognized fork points → open-three criticalGains.
 */
export function collectAttackThreatMoves(
  store: PatternStore,
  attacker: Player,
  recognizedForkPatterns: ReadonlySet<ForkPatternName>,
): Move[] {
  const patterns = store.patterns(attacker);
  const seen = new Set<string>();
  const out: Move[] = [];

  for (const pattern of patterns) {
    if (pattern.type === "four" || pattern.type === "open-four") {
      pushUnique(out, seen, pattern.gains);
    }
  }

  for (const fork of recognizedForkPoints(patterns, recognizedForkPatterns)) {
    pushUnique(out, seen, [fork.move]);
  }

  for (const pattern of patterns) {
    if (pattern.type === "open-three") {
      pushUnique(out, seen, pattern.criticalGains);
    }
  }

  return out;
}

/**
 * Exclusive defence set after an attacker's threat (spec priority 1→2→3).
 * Empty with attacker four/open-four still present means the force already
 * succeeded (unstoppable open-four). Empty with no fours means not forcing.
 */
export function collectDefenceMoves(
  store: PatternStore,
  attacker: Player,
  defender: Player,
  recognizedForkPatterns: ReadonlySet<ForkPatternName>,
): Move[] {
  const attackPatterns = store.patterns(attacker);
  const fours = attackPatterns.filter(
    (p) => p.type === "four" || p.type === "open-four",
  );
  if (fours.length > 0) {
    const candidates: Move[] = [];
    for (const pattern of fours) {
      candidates.push(...pattern.gains);
      const box = boxCell(pattern, store.board);
      if (box !== null) {
        candidates.push(box);
      }
    }
    return survivingBlocks(
      store.board,
      defender,
      attacker,
      dedupeMoves(candidates),
    );
  }

  const forks = recognizedForkPoints(attackPatterns, recognizedForkPatterns);
  if (forks.length > 0) {
    const cells: Move[] = [];
    for (const fork of forks) {
      for (const pattern of fork.patterns) {
        cells.push(...pattern.gains);
      }
    }
    return dedupeMoves(cells).filter(
      (m) => store.board[m.row][m.col] === 0,
    );
  }

  const openThreeCells: Move[] = [];
  for (const pattern of attackPatterns) {
    if (pattern.type === "open-three") {
      openThreeCells.push(...pattern.criticalGains);
    }
  }
  return dedupeMoves(openThreeCells).filter(
    (m) => store.board[m.row][m.col] === 0,
  );
}

function hasAttackerFour(store: PatternStore, attacker: Player): boolean {
  return store
    .patterns(attacker)
    .some((p) => p.type === "four" || p.type === "open-four");
}

function attack(
  store: PatternStore,
  attacker: Player,
  maxPly: number,
  deadline: number | null,
  recognized: ReadonlySet<ForkPatternName>,
  nodeCounter: { count: number },
): Move[] | null {
  if (maxPly <= 0) {
    return null;
  }
  if (deadline !== null && Date.now() > deadline) {
    return null;
  }

  const threats = collectAttackThreatMoves(store, attacker, recognized);
  for (const move of threats) {
    if (deadline !== null && Date.now() > deadline) {
      return null;
    }

    store.place(move, attacker);
    nodeCounter.count += 1;

    if (checkCaroWin(store.board, move.row, move.col, attacker)) {
      store.undo();
      return [move];
    }

    const defender = otherPlayer(attacker);
    // A threat is not forcing if the defender can win immediately instead
    // of answering (e.g. X makes open-four while O already has a four).
    if (hasImmediateWin(store.board, defender)) {
      store.undo();
      continue;
    }

    const defence = collectDefenceMoves(
      store,
      attacker,
      defender,
      recognized,
    );

    if (defence.length === 0) {
      if (hasAttackerFour(store, attacker)) {
        store.undo();
        return [move];
      }
      store.undo();
      continue;
    }

    let allRepliesLose = true;
    let winningLine: Move[] | null = null;

    for (const block of defence) {
      if (deadline !== null && Date.now() > deadline) {
        allRepliesLose = false;
        break;
      }

      store.place(block, defender);
      nodeCounter.count += 1;

      const continuation = attack(
        store,
        attacker,
        maxPly - 2,
        deadline,
        recognized,
        nodeCounter,
      );
      store.undo();

      if (continuation === null) {
        allRepliesLose = false;
        break;
      }

      if (winningLine === null) {
        winningLine = [move, block, ...continuation];
      }
    }

    store.undo();

    if (allRepliesLose && winningLine !== null) {
      return winningLine;
    }
  }

  return null;
}

/**
 * Prove a forced win for `attacker` along option-A threat/defence lines.
 * Conservative: failure means "not proven," not "proven draw."
 */
export function findForcedWin(
  store: PatternStore,
  attacker: Player,
  options: ThreatSearchOptions,
): ForcedWinResult {
  const recognized =
    options.recognizedForkPatterns ?? ALL_FORK_PATTERN_NAMES;
  const nodeCounter = { count: 0 };
  const line = attack(
    store,
    attacker,
    options.maxPly,
    options.deadline ?? null,
    recognized,
    nodeCounter,
  );

  if (line === null) {
    return { won: false, principalVariation: [], nodesVisited: nodeCounter.count };
  }
  return {
    won: true,
    principalVariation: line,
    nodesVisited: nodeCounter.count,
  };
}
