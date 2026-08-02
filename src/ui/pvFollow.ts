// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { placeMove, type Board, type Player } from "../engine/board.ts";
import type { Difficulty } from "../engine/engine.ts";
import {
  MIN_EXPERIENCE_DEPTH,
  type ExperienceMode,
} from "../engine/experience/experience.ts";
import type { SearchResult } from "../engine/search/search.ts";
import type { Move } from "../engine/state.ts";

export interface PvFollowState {
  remaining: Move[];
  depth: number;
  score: number;
  difficulty: Difficulty;
  expectedBoard: Board;
  playerToMove: Player;
}

export function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

export function boardsEqual(a: Board, b: Board): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let r = 0; r < a.length; r += 1) {
    const rowA = a[r];
    const rowB = b[r];
    if (rowA.length !== rowB.length) {
      return false;
    }
    for (let c = 0; c < rowA.length; c += 1) {
      if (rowA[c] !== rowB[c]) {
        return false;
      }
    }
  }
  return true;
}

function buildExpectedAfterEngine(params: {
  boardBeforeEngine: Board;
  enginePlayer: Player;
  engineMove: Move;
  expectedOpp: Move;
}): Board {
  const postEngine = placeMove(
    params.boardBeforeEngine,
    params.engineMove.row,
    params.engineMove.col,
    params.enginePlayer
  );
  return placeMove(
    postEngine,
    params.expectedOpp.row,
    params.expectedOpp.col,
    otherPlayer(params.enginePlayer)
  );
}

export function tryArmPvFollow(params: {
  experienceMode: ExperienceMode;
  difficulty: Difficulty;
  requestBoard: Board;
  enginePlayer: Player;
  result: SearchResult;
}): PvFollowState | null {
  if (params.experienceMode !== "use") {
    return null;
  }
  if (params.result.complete === false) {
    return null;
  }
  if (params.result.depth < MIN_EXPERIENCE_DEPTH) {
    return null;
  }
  const pv = params.result.principalVariation;
  if (pv.length < 3) {
    return null;
  }
  const remaining = pv.slice(1);
  try {
    const expectedBoard = buildExpectedAfterEngine({
      boardBeforeEngine: params.requestBoard,
      enginePlayer: params.enginePlayer,
      engineMove: pv[0],
      expectedOpp: remaining[0],
    });
    return {
      remaining,
      depth: params.result.depth,
      score: params.result.score,
      difficulty: params.difficulty,
      expectedBoard,
      playerToMove: params.enginePlayer,
    };
  } catch {
    return null;
  }
}

export function tryConsumePvFollow(params: {
  state: PvFollowState | null;
  experienceMode: ExperienceMode;
  difficulty: Difficulty;
  board: Board;
  player: Player;
}): { hit: SearchResult; next: PvFollowState | null } | null {
  const state = params.state;
  if (state === null || params.experienceMode !== "use") {
    return null;
  }
  if (params.difficulty !== state.difficulty || params.player !== state.playerToMove) {
    return null;
  }
  if (state.remaining.length < 2) {
    return null;
  }
  if (!boardsEqual(params.board, state.expectedBoard)) {
    return null;
  }
  const move = state.remaining[1];
  const tail = state.remaining.slice(2);
  const hit: SearchResult = {
    move,
    score: state.score,
    depth: state.depth,
    principalVariation: [move, ...tail],
    nodesVisited: 0,
    complete: true,
  };
  if (tail.length < 2) {
    return { hit, next: null };
  }
  try {
    const expectedBoard = buildExpectedAfterEngine({
      boardBeforeEngine: params.board,
      enginePlayer: params.player,
      engineMove: move,
      expectedOpp: tail[0],
    });
    return {
      hit,
      next: {
        remaining: tail,
        depth: state.depth,
        score: state.score,
        difficulty: state.difficulty,
        expectedBoard,
        playerToMove: params.player,
      },
    };
  } catch {
    return { hit, next: null };
  }
}
