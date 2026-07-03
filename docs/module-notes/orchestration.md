# Module note — `orchestration` (the delegation engine)

*Landed 2026-07-04 — vertical-slice + concern-fold, green (`pnpm test` EXIT 0: turbo typecheck 43/43 ·
schema-parity 30 · mcp/sdk parity ok · vitest 1133 pass / 4 skip) + drizzle `generate` → "No schema
changes" (proven in isolation after the schema move). The second substrate pull beneath `@vynel/session`
(after `chat` `1568e91`), mirroring the blessed `chat`/`memory` template.*

## What orchestration is

The **delegation engine** — "the VERB over the `agents` noun" (its own index). It resolves `@mention`s,
composes enabled agents into a session, runs a leaf/workspace-root delegation turn, records the parent→child
tree edges + agent-run lifecycle, and surfaces reports back up to the root. It is a **composition tier above
`chat` + `agents`** (not a leaf), and itself substrate for `@vynel/session` (the session `delegate-*` layer
ties orchestration's run-ops to chat persistence + continuity).

## Scope decisions (the two cross-feature edges)

1. **EXCLUDED `resolve-delegation-trace(.test).ts`** — it was the ONLY file that read `chat`
   (`@vynel/db/repositories/chat`, now `@vynel/chat`). It is a **cross-domain composed VIEW** (the Ch3 trace
   panel), not core delegation logic — so it relocates to the **session/monitor composition tier** (same call
   as `start-chat-turn` → session in the chat pull). Excluding it removes ALL chat coupling; orchestration's
   only remaining cross-dep is `agents`. Nothing internal imported it (terminal read-op) — its 4 index export
   lines were dropped; the `index.ts` now carries a comment recording where it lands + why.
2. **`orchestration → @vynel/agents` is BY DESIGN, kept** — the index says so explicitly ("designed dependency
   is the `agents` domain"). `compose-session-agents`, `resolve-mentions`, `create-leaf-session` rewired
   `@vynel/core/agents` → `@vynel/agents`. `map-agent-to-leaf-input` keeps `import type { AgentRow }` from
   `@vynel/db/repositories/agents` (agents' repos stay in the kernel — agents is a wave-2 leaf not yet
   vertical-sliced). Orchestration is a composition tier, so composing the `agents` leaf is tier-appropriate.

## As-built shape

- **Schema/repos** (git-mv from kernel, history preserved): `schema/{delegation-jobs,index}` +
  `repositories/{delegation-jobs,delegation-jobs.test,index}`. Schema FKs → `@vynel/db/schema/{users,workspaces}`
  (hub-FK, chat precedent); repo → `@vynel/db` + `../schema/`; repo test → `@vynel/testing` +
  `@vynel/db/repositories/{users,workspaces}`.
- **Logic fold** (pulled from old `packages/core/src/orchestration/`, foldered):
  - `leaf/` — the by-reference delegation runtime: `create-leaf-session`, `drain-leaf-turn`, `push-to-session`,
    `map-agent-to-leaf-input`, `run-root-delegation-turn`. **Grouped together because `drain-leaf-turn` is the
    hub** (all 4 others import it) — any split manufactures peer-folder edges; this is the only zero-peer-edge
    grouping. `drainLeafTurn` + `mapAgentToLeafInput` stay OUT of the barrel (internal helpers of
    `createLeafSession`). *Name `leaf/` is provisional (`run-root-delegation-turn` sits slightly oddly under it)
    — refine in review if warranted.*
  - `agents/` — compose the agents noun: `compose-session-agents`, `resolve-mentions`.
  - `records/` — outbox writers: `record-delegation`, `record-agent-run` (→ `../orchestration-events.js`).
  - `queries/` — read-ops: `collect-delegation-reports-for-root`, `list-in-flight-delegations`
    (→ `../repositories/index.js`).
  - `routing/` — the router + enqueue: `route-request`, `enqueue-workspace-delegation`.
  - root: `orchestration-types`, `orchestration-events`, `index`. `test-support/fake-leaf-provider`.
- **Kernel touch-points:** schema barrel dropped `./orchestration/index.js`; drizzle config repointed in place.
  `@vynel/db` root barrel never re-exported schema (confirmed) + zero external `delegationJobs`/`DelegationJob`
  consumers → the barrel-drop is safe.

## Dependency set (as-built)

`@anthropic-ai/claude-agent-sdk` (type-only, see below) · `@vynel/agents` · `@vynel/db` ·
`@vynel/db/repositories/{orchestration→local, _shared, agents}` · `@vynel/errors` · `@vynel/logger` ·
`@vynel/providers`. Dev: `@vynel/testing`, `typescript`. The `providers → orchestration` grep hit was
confirmed a comment (no layering inversion).

## Deferred / flagged (do NOT slip in on red)

- **`enqueue-workspace-delegation` writes a `delegation_jobs` row with no outbox event / no `db.transaction`**
  (`routing/enqueue-workspace-delegation.ts`). Named against invariant 8 (co-commit the outbox in one txn), but
  **non-blocking + faithful:** the enqueue is an intra-feature queue insert; the cross-feature `session.delegated`
  signal fires later at EXECUTION via `recordDelegation` (which DOES co-commit its outbox). No feature needs a
  "queued" signal today. Revisit only if a cross-feature "delegation queued" event becomes needed.
- **`resolve-delegation-trace`** → lands at the **session/monitor** tier (with the other cross-domain composed
  reads + the trace panel backend). It reads `@vynel/chat` messages + orchestration jobs.
- **SDK type dep** — `compose-session-agents` imports `import type { AgentDefinition }` from the SDK (type-only,
  erased; flows through the public `composeSessionAgents` return). Landed faithfully as a real dep, matching the
  reviewed `@vynel/agents` sibling. **Possible improve:** re-export `AgentDefinition` via `@vynel/agents` so
  orchestration carries no direct SDK dep — a clean follow-up if review wants the seam tighter.
- The `orchestration → agents` dep is by-design; if a future review wants it decoupled, that's a session-era call.
