# Journal — approvals backend foundation (2026-07-04)

Chad's ask: "go for approval" — fix the bug where approvals got **stuck / never showed on the frontend**, and move
toward a **global notification queue** (answer approvals one-by-one from ANY screen). Most turns run auto/bypass, so
a card is the exception path but must be reliable. Landed A (vertical-slice, `0fe8192`) + B (the data foundation,
green, commit pending).

## Root cause (mapped, not guessed — via a full cross-repo Explore)
The durable spine already existed (a persisted `approval_requests` table indexed on `(status, requestedAt)` + `userId`,
an `approval.requested` outbox event). The bug was that **nothing surfaced pending approvals globally**, four ways:
1. cards delivered IN-BAND on one session's stream → invisible from any other screen;
2. the persisted rescue was session-scoped + mount-triggered (no global "you have N pending" surface);
3. **brain/global-root cards were never persisted at all** (`handle-approval-requested` dropped `workspaceId === null`);
4. no-watcher (background/channel) turns had no approval channel → hang.

## The design decision that mattered most: notify-not-deny (advisor catch)
The Explore recommended "background sinks fail-closed (auto-deny)." **That's the opposite of what Chad wants** and the
advisor caught it: a routed-leaf sub-session must deny (no human can ever answer, a parent waits synchronously), but a
top-level **brain/channel/scheduled** turn is exactly "no one's watching the stream, but the user answers later from
any screen" → it must **park-and-notify**, not deny. And hangs are already bounded by `recoverStalePendingApprovals`
(~10-min reap), so top-level park-and-notify is safe WITHOUT auto-deny. Recorded in the module note so it's never
re-litigated. The `SessionSink` approval seam itself is DEFERRED (no consumer in KLONE yet — same discipline that
excluded `start-chat-turn` from chat); it's built with `apps/api` when the SSE / channel / routed-leaf consumers exist.

## Scope (Chad's call via AskUserQuestion): "backend foundation (A+B)"
The VISIBLE fix (notification UI, answer-from-any-screen) is gated on `apps/api` (routes) + the frontend (Chad's),
neither of which exists in KLONE. Surfaced that honestly; Chad chose to build the reliable backend now so the queue
lights up as *wiring* when apps/api lands, rather than jumping to apps/api.

## What landed
- **A `0fe8192`** — vertical-slice: `approval_requests` + `approval_rules` schema+repos moved kernel→`@vynel/approvals`
  (the knowledge template). Behavior-neutral (drizzle "No schema changes").
- **B** — the global-queue data layer:
  - `approval_requests.workspaceId` → **nullable**, **baseline-folded** (edit `0000_baseline.sql` + snapshot, drizzle
    "No schema changes"; git diff proved ONLY that one column changed). Brain cards now PERSIST.
  - `listPendingApprovalsForUser(db, userId)` — the user-scoped global-pending read.
  - `resolveApproval` **user-scoped** (see below).

## The reviewer must-fix: a half-widened resolve
The nullable change was applied everywhere EXCEPT the resolver: `ResolveApprovalInput.workspaceId` stayed `string` and
the tenant guard `request.workspaceId !== input.workspaceId` made a brain card (null workspace) **always throw
NotFoundError** — so it persisted + listed but could never be ANSWERED, only time out. Typecheck passed (comparing
`string|null` to `string` is legal), which is why it slipped. The tell: no brain-*resolve* test. **Fix (reviewer's
cleaner option): drop `workspaceId` from the resolve contract entirely**, guard on `userId` alone — the row is unique
by `providerApprovalId`, `userId` gives tenant isolation, and a global-queue caller can't know a brain card's
workspace anyway. Added the brain-resolve test. **Lesson: when widening a column to nullable, grep EVERY consumer —
typecheck won't catch a `null !== string` comparison that silently changes control flow.**

## Deferred (recorded in the module note)
The `SessionSink.onApprovalRequested` seam (notify-not-deny), the HTTP routes (`GET /pending` user-scoped, `POST
/:id/decide`), the notification UI (Chad's frontend), cross-process resolution (Phase 2 — the in-memory
`PendingApprovalRegistry` only resolves in-process; verify later whether background turns run in a separate worker).
Do NOT decouple the `chat → approvals` lazy-import seam — it records synchronously by necessity (the stream needs the
approval id before it can emit the card).

Gate: typecheck · parity 30/mcp/sdk · drizzle "No schema changes" · vitest **1186 (+4)**.
