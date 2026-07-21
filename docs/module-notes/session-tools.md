# Session tools (spawned sessions) — module notes

**Status:** design 2026-07-21, building immediately (Chad: "complete the next slice, then I
smoke with session spawning") · Slice ④ of the session-library arc (memory
`session-library-product-decisions`) — the arc's payoff: the root creates sessions as a
tool, keeps itself context-free, and plans by context usage.

## Chad's advice (the why)

- **Sessions are a tool Claude uses.** `create_session` spawns a NORMAL session — memory,
  instructions, capabilities, its own continuity — not a throwaway agent. The root hands
  work down and receives distilled reports; its own context stays free.
- **The root plans by context usage.** `list_sessions` returns the SAME numbers the
  Sessions panel shows (the Slice-③ overview op re-exposed) — one truth for the user and
  the model.
- **Everything visible.** Spawned sessions appear in the Sessions panel automatically
  (they are chat segments + a primary like everything else), watchable, chain-rendered.
- Recorded for later arcs: default chat model becomes a Settings item; the pool cap
  becomes the "how many sessions Claude can run" setting.

## Shape

### 1. A spawned session IS the existing primitive, new scope

- `PrimarySessionScope` grows `'spawned'` (TS union only — the column is text, NO
  migration; the mechanism's own comment says any kind added gets continuity free).
  MANY per user (no liveness unique index — deliberate; the existing partial indexes
  don't cover 'spawned').
- `ChatSessionScope` grows `'spawned'` the same way; the overview contract/schema/UI
  label follow ("Session").
- **Identity/name**: the FIRST segment's title = the session's name (set at create).
  Swap segments keep the stock hidden title; the Slice-③ chain fold already surfaces the
  newest listed real title — no name column needed.
- **Ground (locked earlier, fork 1): inherits the creator's scope.** V1 exposes the tools
  on the GLOBAL root only → spawned sessions are global-scoped: the root's hidden
  user-data cwd (same memory/settings ground as the brain), `workspaceId` null.
  Workspace-root spawning is the recorded follow-up (needs per-workspace tool exposure,
  nothing structural).

### 2. `create_session` = the priming-seed rails, reused

`createSpawnedSession(db, { userId, name, purpose, workspacePath })`
(`@vynel/session/spawned`): runs a one-turn PRIMING session via the existing
`runSeededSwapSession` machinery (the purpose text is the seed), records the segment as a
LISTED chat row (scope 'spawned', title = name), creates the primary (scope 'spawned')
pointing at it. A spawned session therefore ALWAYS has a segment — it lists, meters, and
chains from birth. Continuity (the 0.85 swap) applies unchanged.

### 3. `send_to_session` = the delegation queue, generalized

Migration `0012_delegation_session_targets` (drizzle-generated; the ONE deliberate schema
change): `delegation_jobs` grows nullable `targetPrimarySessionId`; the three
workspace columns (`workspaceId`/`workspacePath`/`workspaceName`) go NULLABLE (a
session-target row has none). Row invariant (enforced in the enqueue op): exactly one of
workspaceId / targetPrimarySessionId set.

- The tick branches on the target: workspace → `delegateToWorkspaceRoot` (unchanged);
  session → new `delegateToSpawnedSession` — same shared-pipeline shape (resume the
  spawned primary's current SDK session, attributed rows, trace channel, approvals
  surface-up, stop registry, activity feed origin 'delegation', session-channel tee).
- The pool's exclusion key generalizes: `activeTargetKeys` (workspaceId or the spawned
  primary id) — the Slice-② recorded rename lands here. Same-session tasks serialize;
  cross-target parallelism.
- Reports: distilled + pushed to the GLOBAL root's transcript (the workspace-delegation
  precedent, same `recordPushedReportMessage` + `summarizeReport`).
- Boot recovery, budgets, stop routes: inherited unchanged (they key on the job).

### 4. The four tools (one descriptor, global-root streams only v1)

On the routing descriptor's surface (the manager's toolbox, interactive global streams —
the same exposure `send_task_to_workspace` has):

| tool | maps to |
|---|---|
| `create_session` | POST /sessions/spawned (mutatingApproved — carded like other creations? NO: Chad's "Claude manages freely" Apps precedent — uncarded; recorded) |
| `list_sessions` | GET /sessions/overview re-exposed via x-mcp on the EXISTING route (context % included — the planning read) |
| `send_task_to_session` | POST /routing/delegate-session (enqueue; returns { enqueued, jobId } — the send_task_to_workspace family) |

**`stop_session_task` NOT SHIPPED (as-built decision):** the stop route keys on
`partialSessionId`, which the send tools never return (they return `jobId`) — a model-facing
stop tool would be unusable without extra plumbing. The HUMAN stop (chip/panel) covers
session-target jobs unchanged (tested). A model stop tool waits for whichever slice
returns the trace key to the model.

Prompt guidance rides the descriptor: spawn when a task is big/parallel or the target
session's context suits it; check list_sessions' context numbers before choosing.

## Tests

- createSpawnedSession: primary scope 'spawned' + listed named segment + provider priming
  called with the purpose; many-per-user allowed.
- Enqueue invariant: exactly-one-target enforced; migration round-trip.
- Tick: session-target claim runs delegateToSpawnedSession (fake provider), report pushed
  to the global root, stop-wins, exclusion by target key (same-session serializes).
- Overview: spawned entries list with scope 'spawned' + title = name; UI label.
- Tools: descriptor parity (api-tools regen), route tests (create/enqueue/404s).

## Deferred (recorded)

- `stop_session_task` (above — needs the trace key surfaced to the model first).
- Reviewer nits (as-built): a memorized create-handle goes stale after a 0.85 swap
  (list_sessions recovers — the descriptions steer that way; chain-walk fallback later) ·
  post-swap name fallbacks differ between the enqueue route and the tick (one helper
  later) · a session name containing " · " mis-parses the UI color-key (cosmetic; strip at
  create later) · the tick file is past the line cap (extraction seams noted) ·
  createSpawnedSession's three writes aren't one transaction (self-consistent
  low-probability failure, matches sibling creation flows).

- Workspace-root spawning (per-workspace tool exposure; the machinery is target-agnostic).
- Mid-run follow-up messaging into a running session (`pushToSession` rails — the old
  Slice-③-of-five plan); today: queue a follow-up task (FIFO per session serializes it).
- Session archive/close tools (Chad: not now).
- The monitor arc still owns agent.run-* / session.delegated consumption.
