# A conversation blocked on `ask_user` reads idle everywhere

**Status:** FIXED 2026-08-17 — see [Resolution](#resolution) at the bottom.
**Correction:** the title is half wrong. It reads idle only when the turn is
already over; while the turn is parked — the normal case — it reads **running**,
which is worse: the conversation looks like it is working when it is in fact
waiting on the person. See the resolution.
**Kind:** defect
**Area:** `apps/local-api` (MCP composition) + `packages/contracts` (session status ladder)
**Opened:** 2026-08-17 (found while fixing the spawned-approvals grounding — see
[`spawned-session-approvals-record-null-workspace`](./spawned-session-approvals-record-null-workspace.md))

## Symptom

Claude calls `ask_user`, the wizard opens, and the turn parks waiting for the answer. The
conversation's own status light says **idle** — the Sessions row, its dot on the node screen, and
(for the assistant thread) the shell's global row. A pending APPROVAL lights the same surfaces
correctly; a pending ASK does not.

The workspace-level light is unaffected — it already reads asks (`use-workspace-status.ts` folds
both queues into `attention`). This is the per-CONVERSATION ladder only.

## Two independent causes, both needed for the fix

### 1. A workspace chat's asks record no session

`ask_requests` has both columns (`workspaceId` + `sessionId`, the latter a loose ref), and
`runAskUserBridge` writes whatever the tool's scope carries
(`packages/asks/src/mcp/ask-user-tool.ts`). The scope comes from the MCP composition context, and
the three attach sites disagree:

| site | workspaceId | sessionId |
|---|---|---|
| `streams/global-root-turn.ts` | null ✔ (it IS the brain) | `conversationTarget.primarySessionId` ✔ |
| `sessions/run-global-root-turn.ts` (channels) | null ✔ | (same shape) |
| `streams/chat-turn.ts` (workspace chat) | the workspace ✔ | **absent** ✘ |

Not an oversight so much as a sequencing problem: a workspace chat composes its toolset BEFORE the
turn's session id exists — a fresh conversation learns its id mid-stream, which is the entire
reason `createTurnSessionCarrier` exists. The global path can pass one because the brain's PRIMARY
id is stable and known up front.

Evidence (dev DB, 2026-08-17): one `ask_requests` row ever, `workspace_id` NULL + `session_id`
NULL — a global-root ask, where the null workspace is right and the null session is this gap.

### 2. The ladder counts approvals only

`SessionStatusFacts.pendingApprovalCount` (`packages/contracts/src/chat/session-status.ts`) is fed
by `getSessionsOverview` from `listPendingApprovalsForUser`. Asks are never consulted, so even a
correctly-stamped ask would not light the conversation.

## The fix, when we take it

Both halves, in this order — either alone changes nothing:

1. **Give the descriptor context a LAZY session accessor.** The ask descriptor reads
   `context.sessionId` at `build()` time (`ask-mcp-feature-descriptor.ts`), which is too early on
   the workspace path. The turn already carries the answer: `turnSession` (the
   `x-vynel-turn-session` carrier) resolves the moment the session is known, and a tool call can
   only happen after that. So thread a getter rather than a value — the tool reads it at CALL time.
   Prefer widening the context with an optional `resolveSessionId?: () => string | undefined`
   over mutating the existing static field, so no other descriptor changes behaviour.
2. **Count asks in the facts.** Add pending asks to the overview's status facts beside
   `pendingApprovalCount` — either a second count or one `needsInputCount`. Keep them separate on
   the wire if the UI ever wants to say WHICH kind is waiting; the ladder itself treats both as
   `needs_input`.

Chain-scope the read like the approval one (`findSessionStatusMessageFacts` takes the chain's
segment ids — a swap must not lose the fact).

## What is NOT wrong

- **Nullable `ask_requests.session_id` stays nullable.** A channel-driven global turn legitimately
  has no watching session, exactly like the approvals column.
- **The workspace light already works** — don't "fix" `use-workspace-status`; it reads both queues.

## Reproduce

In a workspace chat, get Claude to call `ask_user` (it parks, the wizard shows). While it waits,
look at that conversation's row in the Sessions panel: no mark. Then:

```sh
sqlite3 .data/vynel.dev.db "select id, workspace_id, session_id, status from ask_requests;"
```

A workspace-chat ask comes back with a workspace and a NULL session.

---

## Resolution

Fixed 2026-08-17. Both halves landed together, as predicted — either alone
changes nothing.

### The symptom was misstated

`idle` is what a *settled* conversation shows. A turn parked in
`runAskUserBridge` is blocked inside the stream's `for await`, and
`activity.begin()` fires before the `try` with `activity.end()` in the
`finally` — so the activity entry is still LIVE and the ladder returned
**running**. Both readings are real (the ladder's own test now pins each), but
`running` is the one a user actually hits, and it is the worse lie: "working"
hides that Claude is waiting on them. `needs_input` already outranks `running`
in the ladder, which is exactly why counting the ask is the whole fix.

### The bug file's proposed fix shape was wrong on the id space

It said to thread a getter for `context.sessionId`. That would not have worked:
`SessionToolContext.sessionId` is the `primary_sessions` row id (its own doc
says "NEVER the SDK's session id", and desktop-control depends on that), while
the sessions overview keys on `chat_sessions.id` — the space approvals live in,
because `recordApprovalRequest` is called from `consume-session-event-stream.ts`.
Reusing that field would have made workspace asks carry chat ids and left
global asks on primary ids: one of the two would still never count.

So the two id spaces are now named separately:

- `SessionToolContext.resolveChatSessionId?: () => string | undefined` — new,
  lazy, the CHAT session. Documented beside `sessionId` with why they differ;
  that missing pairing is why the bug existed.
- `TurnSessionCarrier.current()` — the read half of the carrier the streams
  already own. The three attach sites pass it straight through.
- `resolveAskScope(context)` in the ask descriptor — a named seam so the choice
  is a testable decision rather than a spread buried in a factory.

`ask_requests.sessionId` now means what its own schema comment always said
("the chat session whose turn asked"). The global path used to write a primary
id there, which was off-contract; nothing read the column, so correcting it
broke nothing.

### Files

- `packages/mcp-contract/src/mcp-feature-descriptor.ts` — the lazy accessor + the id-space note
- `apps/local-api/src/sessions/turn-session-header.ts` — `current()`
- `packages/asks/src/mcp/ask-user-tool.ts` — scope takes `resolveSessionId`, read at CALL time
- `packages/asks/src/mcp/ask-mcp-feature-descriptor.ts` — `resolveAskScope`
- `apps/local-api/src/streams/chat-turn.ts`, `streams/global-root-turn.ts`,
  `sessions/run-global-root-turn.ts` — the three attach sites (the channel
  runner grew a carrier; its drain sink fills it from the stream's first frame)
- `packages/contracts/src/chat/session-status.ts` — `pendingAskCount` + the ladder
- `packages/session/src/overview/get-sessions-overview.ts` — chain-scoped count,
  mirroring the approval read (one user-wide `listPendingAsks`, grouped)

### Not done, deliberately

Existing ask rows carry primary ids and will never match a segment. One row in
the dev DB; not worth a backfill, and it ages out — the same call already made
for the mis-scoped historical approval rows.
