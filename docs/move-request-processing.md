# Move Request Processing

How `EnginePool.requestMove` turns a board position into a `SearchResult`: experience cache, root narrowing, optional parallel fan-out, and worker-slot allocation.

Primary code: `src/ui/enginePool.ts`, `src/ui/engineProtocol.ts`, `src/ui/parallelSearch.ts`, `src/engine/search/search.ts`.

---

## 1. End-to-end overview

```mermaid
flowchart TD
  UI["UI / session<br/>requestMove(board, player, difficulty, …)"]
  PREP["prepareExperienceForRequest<br/>lookup human + difficulty books"]
  INSTANT{"Strong / usable<br/>instant hit?"}
  REPLAY["Resolve immediately<br/>(optional background reinvest)"]
  PARA{"parallelism > 1<br/>AND experienceMode = use<br/>AND no baseline<br/>AND no rootCandidates?"}
  FAN["runParallelSearch<br/>narrow → partition → N workers"]
  SINGLE["Enqueue / dispatch<br/>one worker job"]
  WORKER["engineWorker<br/>handleEngineRequest → search()"]
  NARROW["narrowRootCandidates<br/>pattern store + narrowCandidates"]
  SEARCH["Strategy: quiet → patternOnly<br/>else → negamax"]
  FLOOR["applyExperienceBaseline<br/>floor result if search loses to book"]
  BOOK["applyResult / applyAggregatedResult<br/>put · stall · settle into experience store"]

  UI --> PREP --> INSTANT
  INSTANT -->|yes| REPLAY
  INSTANT -->|no| PARA
  PARA -->|yes, and fan-out viable| FAN
  PARA -->|no / fan-out returns null| SINGLE
  FAN --> BOOK
  SINGLE --> WORKER --> NARROW --> SEARCH --> FLOOR
  FLOOR --> BOOK
```

---

## 2. Experience cache: instant replay vs search baseline

The pool consults the experience store **before** any worker search. Two outcomes matter for later search quality:

| Outcome | When | Effect on search |
| --- | --- | --- |
| **Instant hit** | Strong usable entry (human book always; difficulty book via `tryUseExperienceHit`) | Return cached move; no foreground search. Non-permanent hits may enqueue a background deepen. |
| **Baseline only** | Usable entry that is not instant-replayed | Pass `experienceBaseline` into the worker. Search seeds that move at the root and **floors** the final result if the live search does not beat the book. |
| **Miss** | No usable entry / mode `off` | Full search with no floor. Parallel fan-out is only considered on this path (and only when `experienceMode === "use"`). |

```mermaid
flowchart LR
  subgraph prepare ["prepareExperienceForRequest"]
    KEY["experienceKeyFor(board, player)<br/>canonical key + transform"]
    HUMAN{"Human book<br/>strong + legal?"}
    DIFF["Difficulty book get(difficulty, key)"]
    TRY{"tryUseExperienceHit<br/>(mode / practice rules)"}
    BASE{"Usable entry<br/>and mode ≠ off?"}
  end

  KEY --> HUMAN
  HUMAN -->|yes| INST["instant result<br/>permanent: true"]
  HUMAN -->|no| DIFF --> TRY
  TRY -->|hit| INST2["instant result<br/>+ baseline"]
  TRY -->|miss| BASE
  BASE -->|yes| BL["baseline only<br/>(no instant)"]
  BASE -->|no| MISS["no baseline"]

  INST --> DONE["Pool returns immediately"]
  INST2 --> DONE
  BL --> SEARCH["Foreground search<br/>with experienceBaseline"]
  MISS --> SEARCH2["Foreground search<br/>(parallel eligible)"]
```

### How the baseline shapes `search()`

```mermaid
flowchart TD
  IN["search(board, player, config)"]
  NR["narrowRootCandidates → effective root moves<br/>(or rootCandidates override from parallel slice)"]
  SEED["seedBaselineMove<br/>book move first in root list"]
  STRAT["Run strategy over rootMoves"]
  FLOOR{"experienceBeatsBaseline<br/>(live vs book)?"}
  KEEP["Keep live SearchResult"]
  USEBOOK["Replace move/score/depth<br/>with experienceBaseline"]

  IN --> NR --> SEED --> STRAT --> FLOOR
  FLOOR -->|yes| KEEP
  FLOOR -->|no| USEBOOK
```

So the cache does not only short-circuit work: when a usable entry exists but is not strong enough for instant replay, it **anchors** root ordering and **guarantees** the returned move is at least as good as the book (by score/depth rules in `experienceBeatsBaseline`).

---

## 3. Narrowing → search (single worker)

Every non-instant path that reaches a worker ends in `search()`:

1. **Narrow** — `narrowRootCandidates` builds/uses a `PatternStore`, counts stones, and runs `narrowCandidates` (forced / tactical / quiet sources).
2. **Override** — if `config.rootCandidates` is set (parallel slice), those moves replace the narrowed set (empty cells only).
3. **Budget** — optional `timeBudgetMs` stepped by own-stone count.
4. **Quiet shortcut** — single candidate or `source === "quiet"` → `patternOnlyStrategy` (no negamax).
5. **Otherwise** — `negamaxStrategy` over the seeded root list.
6. **Floor** — `applyExperienceBaseline` as above.

```mermaid
sequenceDiagram
  participant Pool as EnginePool
  participant Slot as Worker slot
  participant W as engineWorker
  participant S as search()

  Pool->>Pool: prepareExperienceForRequest
  alt Instant hit
    Pool-->>Pool: resolve(prepared.instant)
  else Search
    Pool->>Slot: dispatch(EngineRequest + baseline?)
    Slot->>W: postMessage(request)
    W->>S: handleEngineRequest → search()
    S->>S: narrowRootCandidates
    S->>S: seedBaselineMove (if baseline)
    S->>S: patternOnly or negamax
    S->>S: applyExperienceBaseline
    W-->>Pool: { ok, result }
    Pool->>Pool: applyResult → experience store
    Pool-->>Pool: resolve(result)
  end
```

---

## 4. Parallelism > 1: distribute candidates across workers

Fan-out is coordinated on the **main thread** inside `runParallelSearch`. It runs only when all of these hold:

- Caller did not already pass `rootCandidates` (slice jobs never re-fan-out).
- `parallelism > 1`.
- `experienceMode === "use"`.
- **No** experience baseline (a book floor means single-worker search).
- At least **2 idle** slots after `min(parallelism, idle)`.
- Narrowing source is **`tactical`** and there are **≥ 2** candidates.

Then:

```text
width = min(parallelism, idleSlots, candidateCount)
slices = partitionCandidates(moves, width)   // round-robin, strongest-first order preserved across slices
```

Each slice is a `searchSlice` → `requestMove(..., { experienceMode: "off", persistExperience: false, rootCandidates: slice })`. Workers search their slice only; the coordinator picks the best true score (`aggregateParallelResults`) and writes the aggregate into the book once.

```mermaid
flowchart TD
  START["requestMove<br/>parallelism = K"]
  GATE{"Idle ≥ 2<br/>no baseline<br/>mode = use?"}
  NARROW["Main thread:<br/>narrowRootCandidates"]
  TACT{"source = tactical<br/>and moves ≥ 2?"}
  PART["partitionCandidates<br/>width = min(K, idle, |moves|)"]
  S1["Worker A<br/>rootCandidates = slice₀<br/>experience off"]
  S2["Worker B<br/>rootCandidates = slice₁<br/>experience off"]
  SN["Worker …"]
  AGG["aggregateParallelResults<br/>max score · sum nodes"]
  WRITE["applyAggregatedResult<br/>→ experience book"]

  START --> GATE
  GATE -->|no| SINGLE["Single-worker path"]
  GATE -->|yes| NARROW --> TACT
  TACT -->|no| SINGLE
  TACT -->|yes| PART --> S1 & S2 & SN --> AGG --> WRITE
```

```mermaid
flowchart LR
  subgraph candidates ["Narrowed tactical moves (strongest → weakest)"]
    M0["m0"]
    M1["m1"]
    M2["m2"]
    M3["m3"]
    M4["m4"]
  end

  subgraph slices ["Round-robin into width=3"]
    A["slice0: m0, m3"]
    B["slice1: m1, m4"]
    C["slice2: m2"]
  end

  M0 --> A
  M1 --> B
  M2 --> C
  M3 --> A
  M4 --> B
```

**Implication:** Parallel search explores disjoint root subsets with experience disabled per slice; quality of the *returned* move comes from aggregation. Experience still benefits future turns via the post-aggregate book write — but a **current** baseline forces the single-worker path so flooring stays coherent.

---

## 5. Worker allocation inside the pool

`EnginePool` owns a fixed array of **slots** (`size` set at construction). Each slot is `{ worker, busy, currentId }`. Workers are created lazily (`ensureWorker`) on first dispatch to that slot.

```mermaid
flowchart TD
  REQ["New QueuedJob"]
  IDLE{"Idle slot<br/>!busy?"}
  PREEMPT{"Busy slot running<br/>background improvement?"}
  DISP["dispatch(slot, job)<br/>busy=true · pending.set(id)<br/>postMessage"]
  QUEUE["queue.push(job)"]
  DONE["Worker completes<br/>handleMessage"]
  APPLY["applyResult → book"]
  FREE["busy=false · clear currentId"]
  PUMP["pump(): dequeue next<br/>into newly idle slot"]

  REQ --> IDLE
  IDLE -->|yes| DISP
  IDLE -->|no| PREEMPT
  PREEMPT -->|yes| KILL["terminate worker<br/>reject CancelledError<br/>slot freed"]
  KILL --> DISP
  PREEMPT -->|no| QUEUE
  DISP --> DONE --> APPLY --> FREE --> PUMP
  QUEUE -.->|when a slot frees| PUMP
```

### Job classes and priority

| Kind | How it gets a slot | Queued? | Preemptible? |
| --- | --- | --- | --- |
| **Foreground move** | Idle slot, else preempt background, else queue | Yes | No (only cancelled via `cancelAll`) |
| **Parallel slice** | Same as foreground; N slices need N idle slots up front for fan-out | Via `requestMove` | Same as foreground |
| **Background reinvest** | Only if a slot is already idle; never queued | No | Yes — terminated when a foreground job needs a slot |

```mermaid
flowchart TB
  subgraph pool ["EnginePool slots (example size = 4)"]
    S0["Slot 0 · busy · fg search"]
    S1["Slot 1 · busy · bg deepen"]
    S2["Slot 2 · idle"]
    S3["Slot 3 · idle"]
  end

  subgraph queue ["FIFO queue"]
    Q0["waiting fg job"]
  end

  NEW["New foreground request"] --> TAKE["Prefer Slot 2 (idle)"]
  NEW2["Another fg while only bg free"] --> PREEMPT["Preempt Slot 1 bg"]
  FULL["All slots busy with fg"] --> Q0
  S0 -.->|complete| PUMP["pump → dequeue into free slot"]
  Q0 -.-> PUMP
```

### Lifecycle helpers

- **`cancelAll`** — reject queue + terminate busy workers; idle workers kept; slots marked free; workers respawn lazily.
- **`terminate`** — `cancelAll` + kill idle workers + flush experience store (pool retirement / resize).

---

## 6. Compact “one move” mental model

```text
requestMove
  │
  ├─ prepareExperienceForRequest
  │     ├─ instant hit ──────────────────────────► return (+ maybe bg deepen)
  │     └─ else baseline? ──┐
  │                         │
  ├─ parallelism > 1, use, no baseline, ≥2 idle, tactical ≥2 moves?
  │     yes → narrow (main) → partition → N× searchSlice (exp off)
  │           → aggregate → write book → return
  │     no  → single job on a slot
  │              worker: search(narrow → seed baseline → strategy → floor)
  │              pool: applyResult → book → return
  │
  └─ slot policy: idle → dispatch; else preempt bg; else queue; pump on free
```

This is the path from a move request through narrowing, search, optional root-partition parallelism, experience flooring/caching, and fixed-size worker-pool allocation.
