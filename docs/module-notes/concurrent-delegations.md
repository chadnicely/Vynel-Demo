# Concurrent delegations — module notes

**Status:** design agreed 2026-07-21 (Chad approved all three recommendations; fork
answers folded below) · Slice ② of the session-library arc (memory
`session-library-product-decisions`) · modifies existing machinery, no new leaf.

## Chad's advice (the why)

- **One session working must never block another.** The scenario that opened the arc: a
  workspace session is mid-task and the user asks for something else — today the second
  delegation silently queues behind the first (the service runs ONE job at a time,
  process-wide). The root should fan out, and the coming session-library tools
  (`create_session` / `send_to_session`) are only useful if two targets can actually run
  at once.
- **Users watch everything.** All sessions are visible in the panel, sorted by last-used,
  Watch-able like root→workspace is today. A background delegation must therefore announce
  itself on the activity feed — a turn running invisibly in a workspace thread is against
  the trust doctrine (today ONLY the originating turn announces; the delegation's own
  workspace turn does not).

## Current state (what this slice changes)

- `apps/local-api/src/services/delegation-service.ts` — 1s `setInterval` guarded by an
  `inFlight` boolean: **one delegation at a time across the whole process**. The guard is
  load-bearing (its header explains: an unguarded loop would fan out N live provider
  sessions); the atomic CAS claim (`claimNextPendingDelegationJob`) prevents double-claims
  but not concurrent DIFFERENT jobs.
- Background delegation turns do **not** call `activityFeed.begin()` — the service has no
  `activityFeed` dep. A workspace view has no idea its manager is mid-task unless the user
  opens the Watch panel on the global side.
- Stop path (`DelegationCancelRegistry`, keyed by partialSessionId), the 600s pausable run
  budget, and boot recovery (`failOrphanedClaimedDelegations`) are all already per-job and
  concurrency-safe — untouched.

## Shape

### 1. The bounded pool (delegation-service)

Replace `inFlight: boolean` with a small pool:

- `MAX_CONCURRENT_DELEGATIONS = 3` (constant; see fork A).
- Each tick: **while capacity remains, claim-and-launch** (fire, don't await) until the
  claim returns null or the pool is full. Each run frees its slot in its `finally`.
- The existing CAS claim stays the sole cross-claim guard — the pool only bounds how many
  claimed runs live at once.

**The invariant the pool must add: never two live runs against the SAME workspace.** A
workspace's primary conversation is a single SDK session resumed per run — two concurrent
resumes violate the single-writer assumption the root-turn-lock exists to protect on the
global side. Mechanism:

- In-memory `activeWorkspaceIds: Set<string>` in the service (single process — sufficient,
  same trust level as `inFlight` today).
- `claimNextPendingDelegationJob` gains an optional `excludeWorkspaceIds` filter: the
  oldest pending job whose workspace is NOT currently running. FIFO holds per workspace;
  parallelism happens ONLY across workspaces.
- Generalization note (deliberate): when Slice ④ generalizes the queue to session targets,
  this exclusion key becomes "the target conversation" (workspaceId today, spawned-session
  id later). Name the mechanics accordingly (`activeTargetKeys`), nothing else changes.

### 2. Delegations announce on the activity feed

- `startDelegationService` deps grow **required** `activityFeed` (the
  `runGlobalRootTurn` precedent — required, not optional, so a new call site can't
  silently opt out).
- The claim-and-run tick announces `begin()` immediately before its try/finally (the
  reviewer-mandated zombie-turn placement from the 19 slice), `turn-updated` on
  `onSessionResolved` (the sdk session id it already learns for the stop path), `end()` in
  the finally.
- **Contract: `SessionActivityEvent` origin union grows `'delegation'`** (additive —
  `contracts/chat/session-activity.ts`). The originating channel stays on the JOB row;
  the feed answers "what is running WHERE", and the honest answer is "a delegated task".
- UI effect (mostly free, wired by the 19 slice): the workspace's presence dot lights, the
  open workspace view polls its thread while the background turn runs, and the banner chip
  explains the wait if the user sends into that workspace mid-run. Banner copy for the
  delegation origin: "Working on a task from the assistant…" (see fork C).
- This REVERSES the recorded 19-slice deferral ("delegation turns deliberately NOT on the
  feed — the in-flight poll covers them"): the poll covers the GLOBAL side's chips only;
  the workspace-thread side was the gap, and with N concurrent runs the feed is the only
  scalable answer.

### 3. What deliberately does NOT change

- `send_task_to_workspace` enqueue semantics, the job schema, and statuses — no migration.
- The 600s per-run budget (runs are independent; the pausable approval gate is per-run).
- Stop routes + registry (already keyed per job).
- Boot recovery (all `claimed` rows are orphans at boot regardless of how many ran).
- Root-turn-lock (global-root turns still serialize per user — that lock is about the
  GLOBAL primary; the per-workspace exclusion above is the workspace-side equivalent).
- The tool description's "do NOT call again for the same task" line — follow-up messaging
  into a running child is Slice ④'s `send_to_session`, not this slice.

## Decisions (Chad, 2026-07-21)

- **A. Pool size: constant 3.** Each run is a live Claude SDK subprocess. Chad: the cap
  becomes a USER-FACING setting later ("how many sessions Claude can run") — keep the
  constant in one named home so the settings arc swaps it for a stored preference without
  touching the pool mechanics.
- **B. `'delegation'` origin** on the activity contract — the feed describes what is
  running now; the job row keeps the originating channel for delivery.
- **C. Banner copy: generic v1** ("Working on a task from the assistant…"); persona naming
  rides the sessions-panel slice where identity is already rendered.
- **D. Tool rename (same session): `route_to_workspace` → `send_task_to_workspace`.**
  Chad found the old name odd; the new one parallels `send_to_channel`, prettifies to
  plain words on cards, and sets up the Slice-④ family (`send_to_session`). Renamed at the
  x-mcp source of truth + prompts/docs/fixtures; historical STATE/CHANGELOG mentions kept.

## Tests (ship with the slice)

- **Service pool:** 3 pending jobs across 2 workspaces → two launch concurrently (distinct
  workspaces), the same-workspace second job waits for the first to settle; the cap is
  honored with 4+ distinct workspaces; a settling run frees its slot; a throwing run still
  frees it (finally).
- **Repo:** `claimNextPendingDelegationJob` with `excludeWorkspaceIds` — skips excluded,
  keeps FIFO among the rest; empty exclusion = today's behavior byte-for-byte.
- **Activity feed:** the tick announces begin/updated/end; a mid-turn subscriber replays
  the delegation turn in the snapshot; `end()` fires on failure and stop.
- **Contract:** the origin union addition is additive (existing consumers tolerant —
  verify no exhaustive switch on origin anywhere).

## Deferred (recorded, not built)

- Dynamic pool sizing by machine resources; per-user fairness (Phase 2 multi-user).
- The timed-out detached run still has no stop lever (pre-existing doctrine, unchanged
  by concurrency — the registry entry ends at tick terminal).
- Follow-up messaging into a running child (`pushToSession` rails) — Slice ④.
