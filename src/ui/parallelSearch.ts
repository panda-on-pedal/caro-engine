import type { Move } from "../engine/state.ts";
import type { SearchResult } from "../engine/search/search.ts";

/** Round-robin split so each slice draws evenly from the (strongest-first)
 *  narrowing order. Produces min(k, candidates.length) non-empty slices. */
export function partitionCandidates(candidates: Move[], k: number): Move[][] {
  const slices = Math.max(1, Math.min(k, candidates.length));
  const parts: Move[][] = Array.from({ length: slices }, () => []);
  candidates.forEach((move, i) => parts[i % slices].push(move));
  return parts;
}

/** Fold parallel slice results: the highest true score wins; node counts sum. */
export function aggregateParallelResults(results: SearchResult[]): SearchResult {
  if (results.length === 0) {
    throw new Error("aggregateParallelResults: no results");
  }
  const nodesVisited = results.reduce((sum, r) => sum + r.nodesVisited, 0);
  let best = results[0];
  for (const r of results) {
    if (r.score > best.score) {
      best = r;
    }
  }
  return { ...best, nodesVisited };
}
