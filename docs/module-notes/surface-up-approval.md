# Module notes — surface-up approval (routed tasks that DO work, with your approval)

> Plan for extending the approval/mode story to the brain + delegation. Investigated 2026-07-06
> (KLONE internals + old-repo deferred design). **Get Chad's okay on the shape before building.**

## The problem (Chad, 2026-07-06)

Routing a task to a workspace ("in vynel, list all files") runs it READ-SAFE: any irreversible action
(Bash/write/edit) is auto-DENIED, the task can't finish, and the Ask/Auto/Bypass mode selector does
nothing for it. Chad wants routed tasks to be able to DO work — asking him to approve — and the mode to
actually govern that.

## What we found

- **Old repo:** surface-up approval was **fully designed but never built** (deferred "brain-tree fork 3").
  Its intended v1 model was explicit: **"routing = read-safe by design; real work = the direct workspace
  chat"** (open the workspace, run it there, approve inline). The "re-run in this workspace" message is
  that intended fallback. They estimated surface-up as a medium-large re-architecture (sync delegation →
  resumable).
- **KLONE makes it cheap** — the re-architecture the old repo feared is already in place:
  - `packages/providers/.../build-claude-can-use-tool-callback.ts`: a tool needing approval **awaits a
    Promise** (`PendingApprovalRegistry`); the turn **pauses indefinitely** until `respondToApprovalRequest`
    resolves it. Works for a background turn — no watcher required.
  - `resolveApproval` (`packages/approvals`) already calls `provider.respondToApprovalRequest` before the
    row update — so deciding an approval unblocks the parked turn.
  - The **approval notifier** (`apps/local-web`, built M2/M3) already polls `approvals.listPending()`
    (`listPendingApprovalsForUser`, user-scoped, workspaceId-agnostic) every 5s and decides via
    `approvals.decide`. A routed task's RECORDED approval surfaces there automatically.
  - `approval_requests.workspaceId` is nullable; the queue is user-scoped.
- **The routed auto-deny to replace:** `packages/orchestration/src/leaf/drain-leaf-turn.ts` —
  `onApprovalRequested` currently calls `buildRoutedLeafApprovalDenier` → `respondToApprovalRequest(denied)`
  + a 2-denial circuit breaker → `ROUTED_LEAF_WRITE_BLOCKED_NOTE`.

## The design — surface-up in KLONE

**Two changes make routed tasks first-class (do work, governed by the mode, approved via the notifier):**

1. **Record-and-park instead of auto-deny.** In the routed turn, `onApprovalRequested` →
   `recordApprovalRequest(db, { providerApprovalId, userId, workspaceId, sessionId, toolName, toolInput,
   ... })` and **return without responding** — the provider stays parked. The notifier's 5s poll shows it;
   the user approves/denies; `resolveApproval` → `respondToApprovalRequest` → the parked routed turn
   resumes and completes. The turn's report then bubbles up as today. (The auto-deny + circuit breaker
   stays as the FALLBACK when surface-up is off — see the mode/origin gate below.)

2. **Thread the user's mode into the routed task** (agent-mapped plumbing):
   `StartGlobalRootTurnRequest.mode` → global-root turn holds it → stamps it on the in-process delegate
   request (a header, mirroring `DELEGATION_ORIGIN_HEADER`) → `POST /routing/delegate` reads it → new
   `delegation_jobs.permissionMode` column → the delegation service passes it to `runRootDelegationTurn` →
   `provider.startChatSession({ permissionMode })`. The mode picks WHICH tools card (Ask → most; Bypass →
   floor only; Auto → Anthropic classifier + floor). **Schema change (one nullable column) — deliberate,
   baseline-folded (pre-release).**

**Plus two small pieces:**
3. **Web:** `use-chat-turn` sends `mode` for global turns; the global-chat selector now governs routing.
4. **Global root's own turn:** `run-global-root-turn-core.ts:112` applies `input.mode` instead of the
   hardcoded `'bypass-with-behavior-gate'`, so the brain's own tools respect the mode too.

## The real decisions (Chad's call)

- **A — DIRECTION.** Build surface-up (recommended — it's the "one brain, many hands" vision, and it's
  cheap here), OR keep the old repo's "route = read-safe; do real work in the direct workspace chat" model
  and just smooth that path (a "Continue in workspace →" button on the read-safe report). Surface-up is
  net-new (beyond the faithful move); the direct-chat path already works with inline approvals.
- **B — WEB vs CHANNEL. REVISED by Chad 2026-07-06:** approvals surface **on web ALWAYS** (every recorded
  approval reaches the user-scoped notifier queue), **plus the ORIGIN CHANNEL when the flow came from one**
  — a Telegram-driven turn or delegation pushes the approval request back to Telegram (✅/❌ inline
  buttons), and the user decides from either surface (both go through `resolveApproval`; the second decider
  gets a clean "already handled"). The previous web-only recommendation is dead. This is CHEAP because the
  channels leaf already ships the whole loop, orphaned since the Ch4 rewrite: `enqueue-approval-request.ts`
  (outbound card + buttons), `summarize-approval-for-channel.ts`, `derive-intent-kind` (classifies
  "approve"/"deny"/button payloads), and `route-as-approval-reply.ts` (→ `resolveApproval`). Only the
  producer side is unwired.
- **C — THE PARKED SLOT + TIMEOUT.** The delegation service is **serial (1 job at a time)**, so a routed
  task parked on your approval **holds the slot** until you decide. Decided: **accept the parked-holds-slot
  for v1**, and **suspend `routeRequest`'s wait budget while an approval is parked** (so a task you approve
  after 15 min still completes). The unanswered-card bound is the approvals reaper
  (`recoverStalePendingApprovals`, reaps at `timeoutMs*2` ≈ 10 min → denied → the parked turn resumes and
  reports) — **currently exported but wired NOWHERE; wiring it is part of this build.**

## Recommendation (revised)

Build **surface-up for ALL origins**: routed approvals record-and-park (replacing the auto-deny), the web
notifier always shows them, and a channel origin additionally gets the card pushed to the channel. The
routed default mode stays `bypass-with-behavior-gate` (only the irreversible floor + declared mutating
tools card), so Telegram is only pinged for genuinely irreversible actions; the threaded mode governs
web-origin delegations.

## Sequencing (green + commit each)

1. **Mode threading (no behavior change).** Add `permissionMode` to `delegation_jobs` + the plumbing
   (request → turn → header → route → job → runner → provider). Routed tasks still auto-deny; the mode is
   just carried + applied to which-tools-card. Web sends mode for global. Bind mode to the global-root's
   own turn. Gate green.
2. **Surface-up in routed delegations (all origins).** Replace the auto-deny with record-and-park
   (`recordApprovalRequest` with the target workspaceId; the provider stays parked); channel-origin jobs
   also enqueue the approval card to the origin channel; `drainLeafTurn` surfaces `approval-resolved`
   (breaker now counts user DENIALS); suspend the wait budget while parked; wire the
   `recoverStalePendingApprovals` reaper service. Gate green + code-reviewer (AI seam).
3. **Brain-turn channel push.** A Telegram → global-root turn already RECORDS its approvals (chat consumer
   → global queue → web notifier); thread an `approval-requested` callback from `routeAsChatTurn` through
   `runGlobalRootTurn`'s drain sink so the card also reaches Telegram (the leaf's `enqueueApprovalRequest`,
   full inbound context so typed "approve" correlates).
4. **Polish.** Approval-card context for a routed action (workspace + tool + the task text); dedupe the
   duplicate trace entry; steer the routed agent to read-safe tools for read tasks.

## Open risks

- Net-new beyond the faithful move (building the deferred fork 3) — but the vision, and the plumbing is
  already here. · Serial-slot held while parked (v1-acceptable; the reaper bounds it). · The AI approval
  seam is sacred — the drain change goes through `code-reviewer`. · A user denial now steers the routed
  agent via the deny reason; two denials in one turn still trip the breaker (retry-loop guard). ·
  Delegation-origin channel cards can't correlate a TYPED "approve" (no inbound row to stamp) — buttons
  carry the explicit id, so Telegram works; typed-reply correlation for delegation cards is a noted improve.
