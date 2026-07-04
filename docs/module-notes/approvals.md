# Module note — `@vynel/approvals` (the trust layer)

*Chad's ask (2026-07-04): the approval system is the next module. Two things beyond a faithful move — (1) FIX the
"approvals get stuck / never show on the frontend" bug; (2) redesign toward a **global notification queue**: the user
sees pending approvals as notifications and answers them one-by-one **from any screen**, not bound to the one chat
stream that raised them. Most turns run auto/bypass, so a card is the EXCEPTION path — but when it fires it must be
reliable and reachable.*

## Root cause of "stuck / never showed" (mapped, not guessed)

The durable spine **already exists** and is correct; the gap is that **nothing surfaces a pending approval globally**.
A pending approval lives in TWO places by design: the persisted `approval_requests` row (audit + notification source)
AND a **process-local in-memory `Map`** (`PendingApprovalRegistry` in providers) that holds the paused agent's Promise
and is the lever that un-pauses it. Delivery breaks four ways:

1. **In-band only** — the card is raised on the ONE session's event stream. A UI not watching that exact stream
   (other screen, reload, SSE reconnect) never sees it.
2. **The persisted rescue is session-scoped** — the old UI fetched `/pending` on session-mount, then *filtered to the
   current session*. There is **no global "you have N pending" surface anywhere**. ← the core design bug.
3. **Brain / global-root cards are never persisted** — `handle-approval-requested` DROPS the row when
   `workspaceId === null` (the brain scope). So brain cards are stream-only + un-rescuable. ← a clear data bug.
4. **No-watcher turns hang** — `SessionSink` has no approval channel, so a background/channel drain turn accumulates
   the card and never answers it (the routed-leaf deadlock, one layer up — currently unhandled in KLONE).

The table is ALREADY indexed on `(status, requestedAt)` and `userId`, and the `approval.requested` outbox event is
ALREADY emitted (with no consumer wired). So a user-scoped global queue is a small data addition, not new machinery.

## THE decision (record once — do NOT re-litigate): notify-not-deny for top-level

Two behaviors that look similar and are opposites:
- **Routed-leaf sub-session → DENY.** A parent turn waits synchronously; no human can ever answer. Fail-closed is
  correct. This exists (`buildRoutedLeafApprovalDenier`, `drainLeafTurn`) — leave it.
- **Top-level background (brain / channel / scheduled) → PARK-AND-NOTIFY.** "No one's watching the stream" ≠ "no one
  can answer." The user answers later, from any screen — that IS the queue. Auto-denying here inverts the feature.

**Hangs are already bounded** by `recoverStalePendingApprovals` (reaps unanswered rows at `timeoutMs*2`, ~10 min), so
top-level park-and-notify is safe WITHOUT auto-deny. **Never hard-code fail-closed as the top-level default.** Whatever
`SessionSink` approval seam is built later must *express both* (notify-and-park OR deny), chosen by the caller.

## Plan — staged (faithful first, then the deliberate gap-closers)

**Buildable NOW (consumer-independent, unit-testable at the package level):**
- **Slice A — vertical-slice + fold (faithful, behavior-neutral).** Move `approval_requests` + `approval_rules`
  schema+repos from the `@vynel/db` kernel into `@vynel/approvals` (the knowledge-template shape). Green + drizzle
  "No schema changes". This is module completion AND puts the schema in the right home for Slice B's change.
- **Slice B — the global-queue DATA foundation (small, deliberate).** (a) Persist brain/global-root cards — fix the
  `workspaceId === null` drop (a deliberate schema change: `workspaceId` nullable on `approval_requests`, or route the
  brain to a user-level scope; lands in the package after A). (b) `listPendingApprovalsForUser` — the user-scoped
  global-pending query (the index already supports it). Both directly close root-cause #2 + #3 at the data layer.

**Deferred — WITH the decisions recorded, built when their consumer exists:**
- **The `SessionSink` approval seam** — has NO consumer in KLONE yet (the runner is test-only; no live SSE / channel /
  scheduled caller). Its shape depends on the three consumers (SSE = notify+stream, channel = notify+out-of-band,
  routed-leaf = deny). Building it now = guessing. **Build it WITH `apps/api`** (same discipline that excluded
  `start-chat-turn` from chat). The notify-not-deny decision above is the durable part.
- **The HTTP routes** — `GET /pending` (promote to **user-scoped**, not workspace-scoped), `GET /recent`, `POST
  /:id/decide` (old repo has all three) — land with `apps/api`.
- **The notification consumer + UI** — the outbox handler that materializes a per-user notification from
  `approval.requested`, and the actual notification UI. UI is Chad's (web is his); a KLONE notifications/channels home
  doesn't exist yet.
- **Cross-process resolution (Phase 2)** — out-of-band resolve only works in-process (the Map). If background/channel
  turns run in a separate `apps/worker` from the responder (`apps/local-api`), the Map lookup misses. **Verify later:**
  which process runs background turns? Park-and-notify's resolve depends on it. Not a Phase-1 blocker.

## As-built — Slices A + B landed (2026-07-04)

- **Slice A `0fe8192`** — vertical-slice: `approval_requests` + `approval_rules` schema+repos moved from the
  `@vynel/db` kernel into `@vynel/approvals`. Behavior-neutral (drizzle "No schema changes"), gate green.
- **Slice B** — the global-queue data foundation, green (drizzle "No schema changes"; vitest +4):
  - `approval_requests.workspaceId` → **nullable** (baseline-folded). Brain/global-root cards now PERSIST
    (`handle-approval-requested` no longer drops `workspaceId === null`; `record-approval-request` accepts null +
    parks pending, skipping workspace-rule-eval since no workspace rule can match a workspace-less card).
  - `listPendingApprovalsForUser(db, userId)` — the user-scoped global-pending read (barrel export).
  - **`resolveApproval` is now user-scoped (review-driven completeness fix):** `workspaceId` DROPPED from
    `ResolveApprovalInput`; tenant guard on `userId` ALONE (the row is unique by `providerApprovalId`; a
    global-queue caller answers from any surface + a brain card has no workspace). WITHOUT this, a persisted brain
    card could never be ANSWERED — only time out via the reaper. Covered by a brain-resolve test. The
    `saveApprovalRuleFromDecision` remember-rule path is now reachably guarded on a non-null workspace.
- **Net:** brain cards persist + list + resolve end-to-end at the backend. The VISIBLE queue still waits on
  `apps/api` (routes) + the frontend.

## Do NOT

- **Do NOT decouple the `chat → approvals` lazy-import seam.** It records SYNCHRONOUSLY because the turn stream needs
  the approval id before it can emit the card; outbox-decoupling breaks that ordering. Leave the lazy-import; it's a
  real constraint, not a smell. (Chat's module note flags it — the flag stays a flag.)

## The honest framing (surfaced to Chad)

Slice A does **nothing** for the stuck bug — it's legibility. Slice B fixes the DATA (cards persist, global query
exists) but the **visible** fix — a notification you click from any screen — is gated on `apps/api` (routes) + the
frontend (Chad's), neither of which exists in KLONE. So "fix the approval bug end-to-end" is coupled to "stand up
`apps/api`." What's deliverable now is the reliable backend; the visible queue lights up when `apps/api` lands.
