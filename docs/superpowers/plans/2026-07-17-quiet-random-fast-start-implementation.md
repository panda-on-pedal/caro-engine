# Quiet Random Fast-Start + Open-Two Narrowing

Quick enhancement (no TDD ceremony). Worktree: `pattern-driven-search`.

**Goal:** Quiet boards → weighted-random pick only (no negamax). Open-two `criticalGains` join tactical candidates.

## Changes

1. **`narrow.ts`** — Return `{ moves, source: "forced"|"tactical"|"quiet" }`. Add `open-two` to Step 3 (own + opp).
2. **`search.ts`** — Use `.moves`; root quiet → `patternOnlyStrategy` unless strategy override passed.
3. **Tests** — Assert `.moves`/`.source`; quiet → `depth: 0`; open-two searches; fix fixtures that assumed quiet boards deepen.

## Verify

```bash
npm test -- src/engine/
npm run typecheck
```
