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
- **B — WEB vs CHANNEL.** A CHANNEL-originated delegation (Telegram) has no one at the web notifier to
  approve async, and would park for up to the budget. Recommend: **surface-up only for WEB-origin turns in
  a carding mode; channel-origin + no-mode default stays READ-SAFE auto-deny** (unchanged). The job's
  origin columns already distinguish them.
- **C — THE PARKED SLOT + TIMEOUT.** The delegation service is **serial (1 job at a time)**, so a routed
  task parked on your approval **holds the slot** until you decide. And `routeRequest`'s 600s WAIT budget
  would time the job out if you don't answer in 10 min (the parked turn then recovers via the
  approval-timeout worker → denied → resumes). For v1 (single user) this is acceptable — you're the
  bottleneck anyway — but we should decide: keep the 600s cap, or extend/suspend it while parked on a
  human approval. Recommend: **accept the parked-holds-slot for v1**, and **suspend the wait-timeout while
  an approval is pending** (so a task you approve after 15 min still completes).

## Recommendation

Build **surface-up, scoped to web-origin carding-mode delegations** (Decision A = surface-up, B = web-only,
C = accept slot + suspend timeout-while-parked). Channel delegations and no-mode stay read-safe. The direct
workspace chat remains the fully-interactive path. This gives Chad exactly what he asked — "route a task
that DOES work, I approve it" — reusing the notifier that already exists.

## Sequencing (green + commit each)

1. **Mode threading (no behavior change).** Add `permissionMode` to `delegation_jobs` + the plumbing
   (request → turn → header → route → job → runner → provider). Routed tasks still auto-deny; the mode is
   just carried + applied to which-tools-card. Web sends mode for global. Bind mode to the global-root's
   own turn. Gate green.
2. **Surface-up.** `drain-leaf-turn` records-and-parks (gated: web-origin + carding mode); keep auto-deny
   fallback. Suspend the wait-timeout while an approval is pending. Verify a routed action cards in the
   notifier → approve → the task resumes + reports. Gate green + code-reviewer (AI seam).
3. **Polish.** Approval-card context for a routed action (workspace + tool + the task text); dedupe the
   duplicate trace entry; steer the routed agent to read-safe tools for read tasks.

## Open risks

- Net-new beyond the faithful move (building the deferred fork 3) — but the vision, and the plumbing is
  already here. · Serial-slot held while parked (v1-acceptable). · The AI approval seam is sacred — the
  drain change goes through `code-reviewer`. · Channel-origin surface-up deferred (no async web watcher).
