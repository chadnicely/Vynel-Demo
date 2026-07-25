# `@vynel/monitors` — a per-session event watch for Claude (design, 2026-07-26)

Chad's ask: *"suppose you need to run a background function; on complete you will be notified and
move to the next action — what tool will you use? I wanted you to create that monitor tool. It's
individual to the sessions, no matter if it's global, workspace, child session or agent. Example:
you want me to send a telegram message and you will trigger whenever the event happens."*

So: **not** a background-job status reader. A general **event watch**, **owned by a session**,
that fires when something happens anywhere in Vynel.

## Why this fits Vynel without touching the AI seam

Two facts make this a small leaf rather than a runtime change:

1. **The outbox is already a complete event log.** Invariant 5 — *every* state change co-commits
   its outbox event in one transaction. There are **62 event types** today (`task.completed`,
   `app.crashed`, `schedule.run-completed`, `agent.run-completed`, `knowledge.document-indexed`,
   `approval.requested`, …). Anything that happens in Vynel is already watchable; monitors just
   need to subscribe.

2. **"Wake a session with an inbound event" is a shape Vynel already implements three times** —
   a channel message (`route-as-chat-turn.ts`), a schedule fire, and a report delivery. A monitor
   firing is the fourth, and it generalizes them.

That is the key design claim: a monitor does not need mid-turn injection. It needs to **wake its
owning session as a turn carrying the event** — which Vynel already knows how to do.

## Shape

**Schema** — one leaf table, one migration, no cross-feature FK (loose refs only):

| column | why |
|---|---|
| `id`, `userId` | tenant, phase-2 ready |
| `sessionId` | **the owner.** Global root, workspace root, spawned session, or agent — the primitive is uniform because sessions are (`everything is a session`) |
| `workspaceId` | nullable loose ref — a global monitor has none |
| `description` | what Claude is watching; appears in the wake message |
| `eventTypes` | JSON array of outbox types to match |
| `filter` | JSON narrowing (channelId, workspaceId, jobId, …) — optional |
| `mode` | `once` \| `recurring` — Claude Code's "one notification" vs "one per occurrence" |
| `status` | `armed` \| `fired` \| `stopped` \| `expired` |
| `expiresAt` | **hard deadline, required.** Per `mcp-tool-hang-audit.md`: every wait is bounded. An armed monitor with no expiry is a leak. |
| `firedCount`, `lastFiredAt` | recurring-mode bookkeeping |

**Tools** (every session surface — root, workspace, interactive, spawned):
- `create_monitor(description, eventTypes, filter?, mode?, expiresInMs?)` → `monitorId`
- `list_monitors()` — this session's armed monitors
- `stop_monitor(monitorId)`

All three are session-scoped reads/writes of Claude's own working state — **self-tools**, so per
Chad's 2026-07-26 rule they are **not** approval-gated (nothing destructive; `stop_monitor` only
disarms Claude's own watch).

**The tick** (`runMonitorTick`, beside the delegation tick): scan unprocessed outbox events → match
armed monitors → on a match, **wake the owning session** with the event as inbound, exactly like
report-delivery. `once` marks fired; `recurring` increments and stays armed until `expiresAt`.

## One gap to close for Chad's own example

His example — *"send a telegram message and trigger whenever the event happens"* — needs an event
that does not exist yet. Inbound channel messages route **straight to a turn** without an outbox
row, so there is no `channel.message-received` to subscribe to. That is a small additive co-commit
at the inbound boundary, and it fits invariant 5 (the inbound tick already writes in a
transaction). Worth doing regardless — an inbound message is a state change with no audit event.

## The honest limitation

A monitor fires by **starting a turn**, not by interrupting a running one. For an **idle** session
that is indistinguishable from Claude Code's Monitor. For a session **mid-turn**, the event lands
on the next turn rather than inside the current one. That is the one-shot turn model
(`run-claude-chat-session.ts:108` — `query({prompt: <string>})`); changing it means streaming-input
mode, which is a separate brief (option B in `claude-monitor-primitive.md`).

## Order

1. `list_background_runs` + `get_background_run` — the dead `jobId` handle, one small slice, and a
   prerequisite for anything that waits on a run.
2. `@vynel/monitors` leaf + the three tools + the tick.
3. `channel.message-received` outbox event, so channel watches work.
