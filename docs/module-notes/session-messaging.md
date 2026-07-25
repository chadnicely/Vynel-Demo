# One session-messaging tool + what `partialSessionId` actually is (2026-07-26)

Chad's ask: *"instead of send_task_to_session or report_to_requester we can have a single tool,
message — it will handle all types of communication. Check how the partialSession got handled, how
that got mapped from which chat → chat against the task."*

## `partialSessionId` — the anatomy

**It is a PER-HOP trace key. It is not a per-task or per-conversation id.** That single fact is
what the unified tool has to be designed around.

**Minted** — fresh `randomUUID()` in each of the three enqueue ops, one per request:

| op | file |
|---|---|
| `enqueueWorkspaceDelegation` | `routing/enqueue-workspace-delegation.ts:62` |
| `enqueueSessionDelegation` | `routing/enqueue-session-delegation.ts:55` |
| `enqueueReportDelivery` | `routing/enqueue-report-delivery.ts:62` |

Deliberately distinct from the job id — the comment at the first site says it: *"the job is the
queue row; the partialSessionId is the trace key (a retried delegation could reuse it across job
rows)."*

**Stamped** on two things:
- `delegation_jobs.partialSessionId` — the anchor row.
- `chat_messages.partialSessionId` — every message the hop produces, threaded through
  `consumeSessionEventStream` via `messageAttribution.partialSessionId`.

**Read** — `resolveDelegationTrace(db, { userId, partialSessionId })`:
1. `findDelegationJobByPartialSessionId` → **the tenant gate**. Unknown key and foreign key both
   return the same empty trace (no enumeration leak).
2. `listChatMessagesByPartialSessionId` → every tagged message. The unscoped read is sound
   *because* the anchor already gated ownership — that is load-bearing, not an oversight.
3. Each entry carries its own `sessionId`; `scope` is derived from **the session's `workspaceId`**,
   explicitly NOT from `sourceKind` (the Ch3.5 acknowledgement is `global-root` yet lives on the
   global session — inferring from sourceKind would mis-target the drill-down).

So the chat → chat mapping is: **one key → one job row → N messages across 1–2 sessions**, each
message knowing which session it lives on.

## The gap that matters

`enqueue-report-delivery.ts:62` is explicit: *"A fresh correlation key per delivery … **distinct
from the task's trace that produced the report**."*

So Chad's two-hop example produces **four unrelated keys**:

```
Global --task--> Workspace          key A   (workspace delegation)
Workspace --task--> Spawned         key B   (session delegation)
Spawned --report--> Workspace       key C   (report delivery)
Workspace --report--> Global        key D   (report delivery)
```

Nothing links A→B→C→D. `delegation_jobs.parentSessionId` points at the *reporter's SDK session*,
which gives a weak per-hop backlink, but there is **no stable id for "this task and everything it
caused"**. Each hop is watchable alone; the chain is not.

That is fine for today's Watch panel (it drills one hop at a time) and wrong for a unified
messaging tool, whose whole point is that a conversation between sessions is one thing.

## The design

**A `threadId`** — minted once when a task first leaves a session, then **carried through every
subsequent hop** (task down, report up, re-delegation). Additive column on `delegation_jobs` plus
the same on `chat_messages`, defaulting to the row's own `partialSessionId` for legacy rows so
nothing needs backfilling.

`partialSessionId` keeps its exact current meaning — per-hop, watchable, unchanged. `threadId` is
the new outer envelope. Nothing that reads `partialSessionId` today has to change.

**One tool, `send_message`**, replacing `send_task_to_workspace` / `send_task_to_session` /
`report_to_requester`:

| field | meaning |
|---|---|
| `to` | `"workspace:<id>"`, `"session:<id>"`, or `"requester"` |
| `body` | the task, or the result |
| `kind` | `task` \| `report` — decides the steer the receiving turn gets |

`requester` stays **server-resolved from the caller header** — never a session id from the model.
That fork is already settled (`report-caller-header.ts`) and the unified tool must not reopen it:
a model-visible requester id could be mis-set, and a mis-addressed report is unrecoverable. The
`to` field names a *destination the model legitimately chose*; it never names who asked.

Routing stays exactly as it is today — the three enqueue ops remain, `send_message` dispatches to
one of them. This is a surface change, not an engine change.

## Order

1. `threadId` — additive migration, threaded through the three enqueue ops + message attribution.
2. `send_message` over the existing enqueues; keep the three old tools as thin aliases for one
   release so nothing in flight breaks, then remove.
3. Tool inheritance for spawned sessions (Chad: all the parent's tools, same mode — no depth cap,
   his call) + the tool-first reporting rework from `mcp-tool-hang-audit.md`'s sibling discussion.
