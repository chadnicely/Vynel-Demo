# Module note — `orchestration` (the delegation engine)

*Gate-1 mapped + scoped 2026-07-04. The second substrate pull beneath `@vynel/session` (after `chat` `1568e91`).
Ready to execute — vertical-slice + fold, exactly the `chat` template.*

## What orchestration is

The **delegation engine** — "the VERB over the `agents` noun" (its own index). It resolves `@mention`s,
composes enabled agents into a session, runs a leaf/workspace-root delegation turn, records the parent→child
tree edges + agent-run lifecycle, and surfaces reports back up to the root. It is a **composition tier above
`chat` + `agents`** (not a leaf), and itself substrate for `@vynel/session` (the session `delegate-*` layer
ties orchestration's run-ops to chat persistence + continuity).

## Scope decisions (the two cross-feature edges)

1. **EXCLUDE `resolve-delegation-trace(.test).ts`** — it is the ONLY file that reads `chat`
   (`@vynel/db/repositories/chat`: `listChatMessagesByPartialSessionId` + `findChatSessionById`), which now
   lives in `@vynel/chat` and isn't publicly exported. It is a **cross-domain composed VIEW** (the Ch3 trace
   panel), not core delegation logic — so it relocates to the **session/monitor composition tier** (same call
   as `start-chat-turn` → session). Excluding it removes ALL chat coupling; orchestration's only remaining
   cross-dep becomes `agents`. Nothing internal imports it (terminal read-op) — drop its 4 index export lines.
2. **`orchestration → agents` is BY DESIGN, keep it** — the index says so explicitly ("designed dependency is
   the `agents` domain"). `compose-session-agents`, `resolve-mentions`, `create-leaf-session`,
   `map-agent-to-leaf-input` import `@vynel/core/agents` (→ rewire `@vynel/agents`) + `@vynel/db/repositories/agents`
   (agents' repos stay in the kernel — agents is a wave-2 leaf not yet vertical-sliced). Orchestration is a
   composition tier, so composing the `agents` leaf is tier-appropriate — assess in review, not a fix.

## The map (old `refactor/session-library`, `packages/core/src/orchestration/`)

- **Logic** — ~16 non-test + tests. By concern (fold proposal, refine on pull):
  - *runners:* `run-root-delegation-turn`, `drain-leaf-turn`, `push-to-session`
  - *records:* `record-delegation`, `record-agent-run`
  - *queries:* `collect-delegation-reports-for-root`, `list-in-flight-delegations`  (— `resolve-delegation-trace` EXCLUDED)
  - *agents* (the verb over agents): `compose-session-agents`, `resolve-mentions`, `create-leaf-session`,
    `map-agent-to-leaf-input`
  - *routing:* `route-request`, `enqueue-workspace-delegation`
  - *shared/root:* `orchestration-types`, `orchestration-events`, `index`, `test-support/fake-leaf-provider`
- **Schema** `packages/db/src/schema/orchestration/` — `delegation-jobs` (1 table) — in KLONE kernel today.
- **Repos** `packages/db/src/repositories/orchestration/` — `delegation-jobs` (+ test) — in KLONE kernel today.

## Dependency check — after excluding the trace-read

`@vynel/db` · `@vynel/db/repositories/{orchestration,_shared,agents}` · `@vynel/providers` · `@vynel/errors` ·
`@vynel/logger` · **`@vynel/agents`** (rewire from `@vynel/core/agents` — the designed composition dep). Tests
seed via `@vynel/db/repositories/{users,workspaces}` + `@vynel/testing`. All present in KLONE.

**Verify at execution:** `packages/providers/src/shared/start-chat-session-input.ts` matched an orchestration
grep — confirm it's a type/comment, NOT a `providers → orchestration` layering inversion (providers is below
orchestration). Likely a `SessionDelegatedPayload`-style type reference or a comment.

## The pull plan (chat template)

Vertical-slice into `packages/orchestration/{schema,repositories,+foldered-logic}`: git-mv the `delegation-jobs`
schema+repos from the kernel; pull logic from old repo (EXCLUDE `resolve-delegation-trace*`); rewire
`@vynel/core/agents` → `@vynel/agents`, `@vynel/core/errors` → `@vynel/errors`, repos → `@vynel/db` +
`../schema/`, own repos → local `../repositories/index.js`; drop the trace-read's index exports. Kernel schema
barrel: drop `./orchestration`; drizzle config: repoint `delegation-jobs` path → `../orchestration/src/schema/`.
**Prove neutral:** `drizzle-kit generate` → "No schema changes" + full gate green. `code-reviewer` → commit.

## Deferred (tracked)

- **`resolve-delegation-trace`** → lands at the **session/monitor** tier (with the other cross-domain composed
  reads + the trace panel backend). It reads `@vynel/chat` messages + orchestration jobs.
- The `orchestration → agents` dep is by-design; if the review wants it decoupled, that's a session-era call.
