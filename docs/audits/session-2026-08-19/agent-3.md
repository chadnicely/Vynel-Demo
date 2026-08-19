# Vynel SESSION SYSTEM — deep audit (AUDIT AGENT 3)

Worktree `E:\KLONE\Workspace\vynel\.claude\worktrees\session-audit` @ `06781328` (branch `feature/session-audit`).
Entry point per brief: the DELEGATION ENGINE, then widened to global/voice/continuity/monitoring.
Every `path:line` below is from this checkout. Two throwaway repro tests were run and deleted.

**Legend** — `Ax` = NEW finding (not in `.claude/STATE.md`), `Kx` = already-recorded residual/open fork that I
verified and ranked. CONFIRMED = traced end-to-end with line cites, or reproduced with a test I ran.

---

## 1. Bugs — all scopes (Global · Workspace · Spawned · Agent · Voice · channels)

### A1 · **P1** · scopes: Workspace-root, Spawned, Agent · A routed turn's TIMEOUT releases the target's single-writer lock while the SDK turn is still live
**Where** `packages/session/src/delegation/run-delegation-claim-and-run-tick.ts:812-833` (the `timed-out` branch) +
`apps/local-api/src/services/delegation-service.ts:204-225` (the pool's `.finally`) + `packages/orchestration/src/routing/route-request.ts:17-20,138-139`.

**Evidence**
```ts
// route-request.ts:17-20
// The timeout is "stop WAITING", NOT "stop the target": on timeout we return a
// timed-out envelope, but the routed turn keeps running in its own SDK session.
```
```ts
// run-delegation-claim-and-run-tick.ts:812-816
} else if (outcome.status === 'timed-out') {
  activityHandle.end('failed')
  failDelegationJob(db, claimed.id, `timed-out after ${outcome.timeoutMs}ms`, new Date())
```
…then `return true` → the tick's `finally` (`:876-879`) → the service's `.finally` `activeRunCount -= 1; releaseTargetLock()`.

**Failure scenario** Workspace `Acme` has jobs A and B queued. A's routed turn exceeds `DELEGATION_RUN_BUDGET_MS`
(600 s — reachable on a long build, and *guaranteed* whenever the turn parks on something the wait-gate does not
suspend, see A5/A7). The tick marks A failed and returns; the pool frees the `Acme` key; the very next 1 s poll claims
B and calls `delegateToWorkspaceRoot`, which resumes **the same `currentSdkSessionId`** A is still streaming into. Two
writers on one SDK session — the exact invariant `SessionTargetLocks` exists to hold. Both turns then run
`withBoundaryContinuity` and may both swap the primary; `linkPrimarySessionToSdkSession` races.
Secondary damage: A's `activityHandle` is already `end()`ed, so every later `publishTurnActivityStep` for A is a
no-op (`session-activity-feed.ts:146-151`) — a live turn writing to the user's workspace with **zero** feed
visibility and no way to Stop it (the cancel handle was `end()`ed too, `:877`).

**Repro (RUN, then deleted)** `packages/session/src/delegation/audit-agent-3-timeout-lock.test.ts` — a provider whose
`startChatSession` yields `session-started` and then never ends, `budgetMs: 50`, two jobs on one workspace:
```
✓ returns from the tick (job failed) with the delegated turn still live, and the SAME target is immediately claimable again
   expect(findDelegationJobById(db, jobA)?.status).toBe('failed')   // passes
   expect(provider.started).toBe(2)                                 // passes — TWO live turns, one workspace root
```
**Confidence** CONFIRMED (reproduced).

**Minimal fix** Hold the target key for the *delegate promise*, not the tick: keep a reference to
`delegationPromise` out of `routeRequest` (or have the tick own the race) and release the lock in
`delegationPromise.finally()`. Cheaper interim: on `timed-out`, `provider.interruptChatSession(sessionId)` before
returning — the job is already terminal, so a still-running turn is pure downside.

---

### A2 · **P1** · scopes: Voice, Global, Spawned · A voice turn is indistinguishable from a global-PRIMARY turn on the activity feed → the Global chat can bind and render the VOICE thread
**Where** `apps/local-api/src/streams/global-root-turn.ts:321-325` · `apps/local-web/src/stores/activity-store.ts:61-77`
· `apps/local-web/src/composables/chat/use-continuing-conversation.ts:66-71` · `apps/local-web/src/views/GlobalChatView.vue:113-120`
· `apps/local-web/src/composables/sessions/use-session-statuses.ts:51-56`.

**Evidence** The voice leg begins its feed entry with the *global* scope and **no** `primarySessionId`:
```ts
// global-root-turn.ts:321-325
const activity = c.var.activityFeed.begin({
  userId: c.var.user.id,
  scopeKind: 'global',
  origin: input.voice === true ? 'voice' : 'web',
})
```
The store's "which session is the scope's primary running on" reader keys on exactly that pair:
```ts
// activity-store.ts:64-67
for (const turn of Object.values(serverTurns.value)) {
  if (turn.sessionId === null) continue;
  if ((turn.primarySessionId ?? null) !== null) continue;   // spawned/agent skipped
  if (scope.kind === "global" && turn.scopeKind === "global") return turn.sessionId;
```
and `GlobalChatView` renders whatever that resolves to:
```ts
// use-continuing-conversation.ts:66-71
continuingQuery.data.value?.currentSdkSessionId ?? runningId.value ?? lastRunningId.value
// GlobalChatView.vue:117 — if (shell.target === "continuous") return continuingSessionId.value;
```

**Failure scenario (a)** User speaks to Jarvis; the daemon's voice turn is live. In another window the Global chat
mounts (or the app boots): `root.getContinuing()` is in flight, so `data.value` is `undefined`, `runningId` is the
**voice segment id** → the global chat renders the *voice* transcript and attaches its live watch to the voice
session. `lastRunningId` is sticky (`:47,59-65`), so for any user whose global root has never run a turn
(`currentSdkSessionId === null`) it stays wrong until the scope changes. This is precisely the wall the voice-session
arc built in `chat-search.ts`, the sessions route and `isTurnFromGlobalRoot` — and it is open on the UI side.

**Failure scenario (b)** Same root cause, different consumer:
```ts
// use-session-statuses.ts:51-56
if (entry.scope === "global") {
  const brainTurn = turns.find((turn) => turn.scopeKind === "global" && turn.sessionId === null);
```
whose own comment claims *"Safe to claim: every OTHER global-scope turn on the feed is a spawned session's, and those
always carry their session id from the start."* Both halves are now false: a **voice** turn matches, and so does every
**spawned/agent delegation** — `run-delegation-claim-and-run-tick.ts:318-332` begins with `scopeKind:'global'` and
passes `primarySessionId` but **never `sessionId`**, so during the engine-spawn window (`onSessionResolved` fires only
once the provider turn starts) the Assistant row reads `running` while the assistant is idle.

**Repro (RUN, then deleted)** `apps/local-web/src/stores/audit-agent-3-voice-global-bleed.test.ts`:
```
✓ the voice turn's feed frame (scopeKind global, primarySessionId null) is claimed by the global scope
   expect(store.runningPrimarySessionIdFor({ kind: "global" })).toBe("voice-segment-1")   // passes
```
**Confidence** CONFIRMED (reproduced + traced to the render binding).

**Minimal fix — two lines, and the shape matters.** The right discriminator is `primarySessionId`, **not** a new
`scopeKind`: `session_turns.scopeKind` is a persisted column typed `'global' | 'workspace'`
(`packages/session/src/schema/session-turns.ts:37`), so adding `'voice'` is a migration plus a widened wire enum plus
every consumer's switch — while `primarySessionId` is already on the row (`:45`), already indexed (`:63`), and is
*already* the store's "this turn belongs to its own identity, not the scope's primary" test (`activity-store.ts:66`).
`origin: 'voice'` is likewise already persisted, so nothing new is needed on the wire either.
(1) `global-root-turn.ts:321-325`: stamp `primarySessionId: conversationTarget.primarySessionId` on the feed `begin`
**for voice turns** — the store already skips identity-carrying turns, so the global fallback keeps working and the
voice turn stops impersonating it. (2) `use-session-statuses.ts:52-54`: add `&& (turn.primarySessionId ?? null) === null`
to the pre-resolution window — which fixes the spawned-delegation over-claim in the same line.

---

### A3 · **P1** · scope: Voice (the CALL leg) · A per-call spawned session runs in **ask** mode — the card-less-surface rule the voice arc locked is not applied on `/sessions/:id/turn`
**Where** `apps/voice/src/call/call-session-client.ts:33-37` · `apps/local-api/src/routes/sessions/schemas.ts:113-115`
· `apps/local-api/src/streams/session-turn.ts:90` · `packages/session/src/session-mode.ts:77`.

**Evidence**
```ts
// call-session-client.ts:33-37 — no `mode` in the body
return streamTurnEvents(`${apiUrl}/sessions/${sessionId}/turn`, {
  userMessageText: utterance, model: VOICE_MODEL, thinkingEffort: VOICE_THINKING_EFFORT,
})
```
```ts
// session-turn.ts:88-90
const turnSettings = resolveTurnSessionSettings(input, findChatSessionById(db, sessionId))
const turnPermissionMode = toPermissionMode(turnSettings.mode ?? DEFAULT_SESSION_MODE)   // 'ask'
```
A per-call session is born with NULL settings (`packages/session/src/spawned/create-spawned-session.ts:88-94` writes
no settings columns), so `input.mode ?? row.sessionMode ?? DEFAULT_SESSION_MODE` = `'ask'`.

**Failure scenario** Vynel is in a live call. A participant says "note that down" / "check the log". The turn calls a
floor tool (Bash/Write/Edit are in the static card floor) → `buildClaudeCanUseToolCallback` parks the agent on a card
nobody in the call can see (`packages/providers/src/claude/approvals/build-claude-can-use-tool-callback.ts:69-90`).
The call goes silent for up to `timeoutMs * 2` (10 min) until the approvals reaper denies it
(`packages/approvals/src/requests/recover-stale-pending-approvals.ts:68`). The whole rationale for the wake leg's
no-mode rule — *"an inherited 'ask' would hang a hands-free interaction on a card nobody can see"*
(`global-root-turn.ts:142-149`) — is not enforced here because the call leg goes through a *different* route with its
own surface default.
**Confidence** CONFIRMED (traced: schema optional → client omits → route default).

**Minimal fix** Send `mode: 'bypass'` (or the voice tier's own mode constant, next to `VOICE_TIER_MODEL` in
`packages/contracts/src/chat/voice-tier.ts`) from `call-session-client.runCallTurn`. Promoting the mode into the voice
tier constant keeps "one tier home" — the same consolidation commit `06781328` already did for model/effort.

---

### A4 · **P1** · scopes: Global, channels, report delivery · One parked `ask_user`/approval on the interactive GLOBAL turn wedges the entire `${userId}` root-turn lock — with no timeout anywhere
**Where** `packages/session/src/runtime/root-turn-lock.ts:24-32` · `apps/local-api/src/streams/global-root-turn.ts:209-219`
· `packages/session/src/runtime/run-global-root-turn-core.ts:93-94` · `packages/session/src/delegation/run-report-delivery-tick.ts` (global branch, `~:300-330`, `:430-437`)
· `packages/orchestration/src/repositories/delegation-jobs.ts:383-408,414-442`.

**Evidence**
```ts
// global-root-turn.ts:209-211
// ask_user here waits UNBOUNDED — this stream is the app's global chat, the user is present.
```
There is no running asks reaper — `expireAskRequests` runs only at boot (`apps/local-api/src/boot.ts:422`) and in the
stream's own `finally` (`global-root-turn.ts:412-419`), which cannot run while the turn is parked. The lock is an
unbounded promise chain:
```ts
// root-turn-lock.ts:25-31
const previousTail = rootTurnTailByLockKey.get(lockKey) ?? Promise.resolve()
const chainedTurn = previousTail.then(turn, turn)
```

**Failure scenario** The user asks the global assistant something, it calls `ask_user`, the user walks away. Now:
every later global web turn queues silently (see A8 — no `turn-queued{busy}` frame is emitted for the *busy* reason on
this stream, so the composer just looks frozen); every **Telegram/Discord** message queues behind it and the channel
user gets nothing; and every **global report-delivery** job claims, calls `runGlobalRootReportTurn`, parks on the same
lock and **times out at 600 s** → `failDelegationJob` (`run-report-delivery-tick.ts:430-437`). A failed delivery row is
excluded from `listUnsurfacedTerminalDelegationsForUser` (`:383-408`), `listInFlightDelegationsForUser` (`:414-442`)
and `listRecentDelegationJobsForUser` (`:454-472`) — so the child's report vanishes from every tracking view, and if
the process restarts before the queued turn drains, the report is gone (only `claimed` deliveries requeue,
`:584-598`). The one mercy is that the queued delegate promise eventually runs and persists the inbound row.
**Confidence** CONFIRMED (traced at each hop).

**Minimal fix** Two independent guards, both small: (1) give the global-scope delivery its own bound by marking the
delivery's `ApprovalWaitGate` from the ask/approval registry (see A5) *or* skipping the delivery claim while
`isRootTurnLockBusy(userId)` — the pool already has the exclusion-key machinery; (2) treat a `timed-out` delivery like
a recoverable failure (`requeueIfRecoverable`) instead of a terminal `failed` — the report body is the only copy, and
`requeueOrphanedClaimedReportDeliveries`' own header states that policy for the crash case.

---

### A5 · **P2** · scopes: Global report/note delivery · A parked approval does **not** suspend the delivery budget on the GLOBAL branch (it does on the workspace branch)
**Where** `packages/session/src/delegation/run-report-delivery-tick.ts:~296-330` (global branch) vs `:~355-400` (workspace branch)
· `packages/session/src/delegation/build-routed-approval-handler.ts:65-68,100-102`.

**Evidence** The global branch creates a `waitGate`, hands it to `routeRequest` — and then never wires anything that
calls `markParked()`:
```ts
// run-report-delivery-tick.ts (global branch)
// Approvals inside the global turn park on the core's own canUseTool path
// (web notifier), not this waitGate.
```
The workspace branch, by contrast, builds a `buildRoutedApprovalHandler({ …, waitGate })` and threads it into
`delegateToWorkspaceRoot`, whose event loop calls `onApprovalRequested/onApprovalResolved`
(`delegate-to-workspace-root.ts:291-296`).

**Failure scenario** A global notify turn hits the card floor (delivery rows always carry `permissionMode: null` →
`bypass-with-behavior-gate`, `enqueue-report-delivery.ts:107`). The user takes 12 minutes to approve; the delivery
budget never pauses, fires at 600 s, the row records `failed` while the turn goes on to succeed. The *identical*
delivery to a workspace requester survives the same 12 minutes. Same loss surface as A4.
**Confidence** CONFIRMED (traced; the divergence is explicit in the code's own comment).

---

### A6 · **P2** · scopes: Workspace, Spawned, Agent · Mode INVERSION — an interactive turn whose session has no persisted mode runs `ask` but stamps **no** mode header, so its delegated children run `bypass-with-behavior-gate`
**Where** `apps/local-api/src/streams/chat-turn.ts:119,176-177` · `apps/local-api/src/streams/session-turn.ts:90,104-107`
· `apps/local-api/src/sessions/delegation-mode-header.ts:42-50`.

**Evidence**
```ts
// chat-turn.ts:119     const turnPermissionMode = toPermissionMode(turnSettings.mode ?? DEFAULT_SESSION_MODE)  // 'ask'
// chat-turn.ts:176-177 turnSettings.mode !== undefined ? wrapAppRequestWithMode(...) : c.var.appRequest
```
(identical pair at `session-turn.ts:90` and `:104-107`).

**Failure scenario** Any caller that does not send `mode` — the CLI, a script, an MCP-driven turn, the call leg, or a
web client before its settings query resolves — against a session with NULL `sessionMode`. The parent's own tools card
(`ask`), but every `delegate`/`send_message` it enqueues carries `permission_mode = NULL`, and the tick runs the child
under `bypass-with-behavior-gate`. That is the *opposite* direction from the recorded residual (which is about `auto`
parents producing `ask` children) and it is the safety-relevant direction: the user is in Ask mode and the children
are not. STATE.md records the "stamp only a RESOLVED mode" choice as deliberate ("unset session keeps the unattended
default, global parity") — but the deliberate half was about the *global* stream, whose own turn also defaults to
bypass. On the two `ask`-defaulting streams the choice makes parent and child disagree.
**Confidence** CONFIRMED (traced). The web composer always sends `mode`
(`apps/local-web/src/composables/chat/use-chat-turn.ts:177-181`), so the blast radius is non-web callers today —
which is exactly the call leg (A3).

**Minimal fix** Stamp the *resolved* mode (`turnPermissionMode`), unconditionally, on both interactive streams —
one home, one value, parent and child provably identical.

---

### A7 · **P3** (latent — unreachable with today's provider; see the verdict at the end) · scopes: all delegated targets · An `approval-requested` that arrives before `session-started` is forwarded **without persistence** → no row for the reaper → an unbounded park that also disarms the routed turn's only timeout
**Where** `packages/chat/src/turn-consumption/handle-approval-requested.ts:43-56` ·
`packages/chat/src/turn-consumption/consume-session-event-stream.ts:141,147-179` ·
`packages/orchestration/src/routing/route-request.ts:87-94`.

**Evidence** `sessionId` stays `null` until `session-started` — the durability-first block persists the user row but
does **not** set it (`consume-session-event-stream.ts:147-179` assigns only `userMessage`). Then:
```ts
// handle-approval-requested.ts:43-49
if (!sessionId) {
  logger?.warn(..., 'approval-requested forwarded without persistence (no session row yet)')
  return { kind: 'approval-requested', ... }        // no approval_requests row
}
```
The forwarded event still reaches `delegate-to-*`'s `case 'approval-requested'` →
`approvalHandler.onApprovalRequested` → `waitGate.markParked()` → `startPausableTimeout`'s `disarm()`
(`route-request.ts:87-93`). With no DB row, `recoverStalePendingApprovals` has nothing to reap
(it reads `listStalePendingApprovalRequests`), so nothing ever resolves the `canUseTool` promise.

**Failure scenario** The job stays `claimed` **forever**: the tick never returns, its `finally` never runs, the
`SessionTargetLocks` key is held for the process's life, and one of the three
`VYNEL_MAX_CONCURRENT_DELEGATIONS` slots is burnt. The target conversation becomes permanently unwritable (a user DM
into it parks on `locks.acquire`, `session-turn.ts:262`, with no timeout). Only a restart recovers, via
`failOrphanedClaimedDelegations`.
**VERDICT — the trigger is UNREACHABLE with the Claude provider, so this is a latent invariant, not a live bug.**
`runClaudeChatSession` awaits the SDK's **first** message (`system/init`), sets `sessionIdHolder.current`, and yields
`session-started` *before* entering the interleave race:
```ts
// packages/providers/src/claude/session/run-claude-chat-session.ts:227-242
sessionId = firstSessionId
sessionIdHolder.current = sessionId
…
yield { kind: 'session-started', sessionId, … }
…
// :274-280 — only NOW is the synthetic queue ever dequeued
while (true) {
  pendingSdkNext ??= queryInstance.next()
  pendingDequeue ??= syntheticEventQueue.dequeue()
```
`canUseTool` can *enqueue* early, but the queue is never *drained* before `session-started`; downstream,
`consume-session-event-stream.ts:206-233` assigns `sessionId` synchronously in the `session-started` case, so the
`!sessionId` branch cannot be entered. The stale comment at `build-claude-can-use-tool-callback.ts:21-23` ("may arrive
after the first tool use") is what makes it *look* reachable.

**Confidence** CONFIRMED unreachable today. **Why it still belongs in the report:** it is a **fail-OPEN** branch in a
path where every other decision is fail-closed, and its safety depends entirely on an ordering guarantee that lives in
another package with no test pinning it. A second `AiAgentProvider` (the `codex/` sibling the providers structure
anticipates) or an SDK ordering change reintroduces a permanent lock leak with no recovery below a restart.

**Minimal fix** (cheap, do it while touching the file) Two belts: (a) in `handle-approval-requested`, when `sessionId`
is null, **deny** rather than forward — fail-closed is the house rule everywhere else in this path; or (b) make
`waitGate.markParked()` conditional on the approval having been recorded, by carrying the record outcome on the
`approval-requested` ChatTurnEvent.

---

### A8 · **P2** · scope: Global (+ Voice) · The global-root SSE stream never emits `turn-queued { reason: 'busy' }`
**Where** `apps/local-api/src/streams/global-root-turn.ts:345-347` vs `apps/local-api/src/streams/session-turn.ts:255-262`.
```ts
// global-root-turn.ts:345-347 — only the swap reason
if (isPrimarySwapping(conversationTarget.primarySessionId)) {
  await stream.writeSSE({ event: 'turn-queued', data: JSON.stringify({ reason: 'context-patching' }) })
}
```
The DM stream emits both reasons; the global stream cannot even tell — the lock has no `isBusy` reader
(`root-turn-lock.ts` exports only `runUnderRootTurnLock`). **Failure scenario:** a second global send (another window,
or a Telegram turn already running) sits with a spinner and no explanation for minutes. Under A4 it never resolves.
**Confidence** CONFIRMED. **Fix:** export `isRootTurnLockBusy(lockKey)` from `root-turn-lock.ts` and emit
`{reason:'busy'}` — the client already renders it (`sidebar queued note per reason`).

---

### A9 · **P2** · scope: Agent (mentions) · `@agent` colleague runs never inherit the turn's **thinking effort**
**Where** `packages/orchestration/src/routing/enqueue-agent-run.ts:26-56` (no `thinkingEffort` field at all; the insert
hardcodes `thinkingEffort: null`) vs `apps/local-api/src/sessions/composer-mention-turn.ts:190-194` (agents: mode +
model only) and `:215-219` (personas: mode + model + **effort**). The interface's own doc at
`composer-mention-turn.ts:52-53` says the picks are *"threaded onto persona delegations AND colleague runs"* — the
code contradicts it for effort. **Failure scenario:** the user picks `max` effort, `@researcher` runs at the provider
default. **Confidence** CONFIRMED. **Fix:** add `thinkingEffort` to `EnqueueAgentRunInput` and forward it — 4 lines,
mirrors the persona branch exactly.

### A10 · **P3** · scope: Agent · A colleague whose identity resolve failed enqueues **targetless** and loses same-colleague FIFO
`composer-mention-turn.ts:141-155` best-effort-resolves each colleague; on failure `targetPrimarySessionId` is omitted
(`:186`) and the tick keys the job on `claimed.id` (`run-delegation-claim-and-run-tick.ts:196-204`), so two mentions of
one colleague can run **concurrently on the same resumed session**. Narrow (needs a DB error), but the exact
single-writer hazard the stamping exists to prevent. **Fix:** on resolve failure, skip the enqueue (or resolve inside
the tick *before* `onRunStarted`).

### Verified-clean (worth recording so the next audit skips them)
* The voice/global **wall is intact on its three TOOL/ROUTE fences — and has no fourth home on the UI liveness side,
  which is what A2 is.** The three that exist: `packages/chat/src/repositories/chat-search.ts:75-76`
  (`AND s.scope NOT IN ('global','voice')`), `apps/local-api/src/routes/sessions/index.ts:249-251`
  (`forbiddenScopes: fromGlobalRoot ? [] : ['global','voice']`), `apps/local-api/src/sessions/turn-session-header.ts:56-60`
  (`isTurnFromGlobalRoot` accepts both scopes). The Postgres search path is an unimplemented throw, so no dialect drift.
  What the arc never built is a fence in the **activity-feed vocabulary** — the one surface that carries a running
  voice turn into the UI. A2 is that missing fourth home, not a UI nit.
* The voice chain is correctly invisible in the overview: `fold-session-chains.ts:68-69` drops any all-hidden chain
  whose tail is not `global`, and every voice segment is `visibility:'hidden'` (`run-global-root-turn-core.ts:279-282`).
* The swap register clears in a `finally` (`continuity/bridge-primary-session.ts:112-113`) — a throwing swap cannot
  leave a permanent "patching context" mark.
* Restart safety at boot is complete: report deliveries requeue, other claimed rows fail + push an honest failure
  delivery, tool calls and `session_turns` are reaped (`delegation-service.ts:113-158`, `boot.ts:287-309,415-429`).

---

## 2. Where a session can get STUCK while running

| # | Stuck point | How it happens | Recovery | Evidence |
|---|---|---|---|---|
| S1 | **Routed approval parks with no persisted row** (A7) — *latent only*: unreachable with the Claude provider (`run-claude-chat-session.ts:227-280` yields `session-started` before the synthetic queue is ever drained) | card arrives pre-`session-started` → no `approval_requests` row → reaper blind; `waitGate` disarms the only timeout | **none** short of restart, if it ever fires | `handle-approval-requested.ts:43-56`, `route-request.ts:87-93` |
| S2 | **Global root-turn lock wedged** (A4) | unbounded `ask_user` (or any never-answered card) on the interactive global turn | user answers the ask, or restart | `root-turn-lock.ts:24-32`, `global-root-turn.ts:209-211` |
| S3 | **Delivery timeout ≠ recovery** (A4/A5) | a global delivery parked behind S2 or a card times out → `failed`, excluded from every net | none (body only survives in the late-running turn) | `run-report-delivery-tick.ts:430-437`, `delegation-jobs.ts:383-442` |
| S4 | **Target lock released under a live turn** (A1) | 600 s budget expires; turn keeps writing invisibly | none — it is *invisible*, not stuck | see A1 |
| S5 | **DM into a spawned session parks unbounded** | `await locks.acquire(spawned.id)` has no timeout; if the holder is S1, the DM never runs | none | `session-turn.ts:262` |
| S6 | **Call leg silent for 10 min** (A3) | `ask` mode cards a floor tool on a card-less surface | approvals reaper at `timeoutMs*2` | `session-turn.ts:90` |
| S7 | **Continuation loop** | bounded: `MAX_CONSECUTIVE_CONTINUATIONS = 3`, reset per genuine turn; terminal gate requires `session-completed` | self-limiting — **clean** | `pending-checkpoints.ts:17,63-67`, `run-turn-with-continuations.ts:81-94` |
| S8 | **Retry loop** | `requeueIfRecoverable` + `nextAttemptAt` backoff; the tick's own `catch` is deliberately terminal (never requeues its own bookkeeping throw) | bounded — **clean** | `run-delegation-claim-and-run-tick.ts:860-871`, `settle-failed-delegation-attempt.ts` |
| S9 | **Claim/lease** | there is no lease at all — a claim is held by an in-process `Map` only; a crash mid-run is cleaned at boot | boot reap — **clean for Phase 1**, a Phase-2 hole | `delegation-jobs.ts:553-598`, `session-target-locks.ts:15-17` |
| S10 | **Swap never completes** | `bridgePrimarySession` marks/clears in `finally`; `withBoundaryContinuity` catches both prepare and swap and reports "stayed" | **clean** | `bridge-primary-session.ts:89-131`, `with-boundary-continuity.ts:85-123` |
| S11 | **SDK stream never ends** | no per-turn wall clock on the *interactive* paths at all; the SSE stream and the root lock both wait forever | none | `global-root-turn.ts`, `chat-turn.ts`, `session-turn.ts` (no timeout anywhere) |
| S12 | **Client detach** | deliberate: a disconnected DM stream still runs to completion and writes no-op | by design | `session-turn.ts:449-459` |

**The shape of the problem.** Every *background* path has a budget (`DELEGATION_RUN_BUDGET_MS`); every *interactive*
path has none, and the interactive global path holds a lock that the background paths must also acquire. That is the
single structural reason S2→S3 cascade exists. A `VYNEL_GLOBAL_TURN_MAX_MS` on `runUnderRootTurnLock` (interrupt +
release, never silently) would collapse S2, S3 and S11 into one bounded failure.

---

## 3. Modes · models · effort · auto-buildout — binding and inheritance

Resolution rule everywhere interactive: `input ?? chat_sessions row ?? surface default`
(`packages/chat/src/settings/resolve-turn-session-settings.ts:31-35`). Write-through is **input-only**
(`persist-turn-session-settings.ts:26-32`), so an omitted field stays "never set".

| Path | mode | model | effort | auto-buildout | source of truth | verified by |
|---|---|---|---|---|---|---|
| Global web (`streamGlobalRootTurn`) | input ?? row ?? **core bypass** ; header stamped only if resolved | input ?? row | input ?? row | write-through only | `chat_sessions` row | `global-root-turn.ts:150-171,338-340` |
| **Voice** (daemon wake, web overlay, Voice-chat panel) | input only (no read/write) | `VOICE_TIER_MODEL`, **fit-clamped** | `VOICE_TIER_THINKING_EFFORT` | never | the pin, one home | `global-root-turn.ts:150-155,181-195,338-340`; `contracts/chat/voice-tier.ts:14-15` |
| **Voice CALL leg** (`/sessions/:id/turn`) | **`ask`** ⚠ **A3** | voice tier | voice tier | written through ⚠ | route default | `call-session-client.ts:33-37`, `session-turn.ts:90,283` |
| Workspace chat | input ?? row ?? **`ask`**; header only if resolved ⚠ **A6** | input ?? row | input ?? row | write-through | `chat_sessions` row | `chat-turn.ts:112-129,176-177,269` |
| Spawned/agent DM | same as above ⚠ **A6** | input ?? row | input ?? row | write-through | row (born NULL ⚠ **K2**) | `session-turn.ts:88-107,283` |
| Delegation → workspace-root | job `permission_mode` ?? bypass-w-gate | job `model` | job `thinking_effort` | n/a | `delegation_jobs` row | `run-delegation-claim-and-run-tick.ts:494-503`; test at `…tick.test.ts:210-240` |
| Delegation → spawned | same | same | same | n/a | same | same |
| Delegation → agent colleague | same | job model **?? the agent's own** | job effort (**always NULL** ⚠ **A9**) | n/a | same | `…tick.ts:601-604`, `enqueue-agent-run.ts:79-84` |
| `agent-run` (@mention) | turn mode (stamped) | turn model | **never** ⚠ **A9** | n/a | `composer-mention-turn.ts:190-194` | code |
| Persona (@workspace mention) | turn mode | turn model | turn effort ✔ | n/a | `composer-mention-turn.ts:215-219` | code |
| Checkpoint continuation job | **copied from the parent job** | copied | copied | n/a | `enqueue-checkpoint-continuation.ts` | `…continuation.test.ts` |
| Report/update/direct delivery | always `null` → bypass-w-gate (deliberate) | null | null | n/a | `enqueue-report-delivery.ts:107-109` | code |
| Note delivery | caller's mode (optional) | null | null | n/a | `enqueue-note-delivery.ts:99-102` | code |
| Channels (`runGlobalRootTurn`) | none → core bypass-w-gate (deliberate, recorded) | optional input | none | n/a | `run-global-root-turn.ts:391,417` | code |
| Monitor / schedule / task wake | enqueues a delivery or session-delegation → inherits that row's nulls | null | null | n/a | `run-monitor-tick.ts:189-255` | code |
| Swap copy-forward | copied onto the fresh segment (both homes) | copied | copied | copied | `handle-session-started`, `record-swap-segment-session` | STATE + code |

**Gaps, ranked:** A3 (call leg = `ask`) → A6 (mode inversion) → A9 (agent effort dropped) → K1 (no fit guard on a
delegated small-model pick) → K2 (spawned sessions born NULL). `auto-buildout` is write-through-only everywhere and
nothing consumes it (`schemas.ts:116-119` says so) — dead weight worth deleting or wiring.

### K1 · **P2** · recorded residual, **REAL and reachable** — the fit guard is voice-only
`fitPinnedModelToSession` is wired at exactly one call site (`global-root-turn.ts:182-195`, gated on `isVoiceTurn`).
A `delegate(model: 'claude-haiku-4-5')` onto a spawned primary that already sits at 400 k tokens is the identical
"Prompt is too long" class — `delegate-to-spawned-session.ts` passes `input.model` straight to `startChatSession` with
no occupancy check. Rank: worth doing, cheap (the guard is 69 lines and pure), and it protects the path a *user* can
trigger from a chat message.

### K2 · **P2** · recorded residual — spawned sessions are born with NULL composer settings
Confirmed: `create-spawned-session.ts:88-94` writes name/workspace only. Consequence in this checkout is A3 + A6, not
just "a DM defaults to ask". Birth-stamping the creator's resolved settings closes both.

---

## 4. Places we missed / improvements

1. **`routeRequest`'s wait budget is the only timeout in the system, and it is the *wrong* one.** It bounds waiting,
   not work; the runner keeps going (A1). Every other timeout in the app (approvals reaper, channel ask, process
   timeouts) bounds a *thing*. Make the delegated turn itself abortable (an `AbortSignal` into `startChatSession`) and
   the whole S1/S4 family collapses.
2. **No DB-side lease on `delegation_jobs`.** `claimedAt` is written but never read as a lease — orphan recovery is
   purely boot-time (`failOrphanedClaimedDelegations`). Phase 2 (multi-process) breaks the moment two processes run.
   The column is already there; a `claimedAt < now - leaseMs` predicate in `claimNextPendingDelegationJob` plus a
   heartbeat is the pre-work.
3. **`run-delegation-claim-and-run-tick.ts` is 911 lines** and holds six job kinds' policy. `routes/root/index.ts` is
   503 (recorded). Both are over the ~300-line house cap. The tick splits cleanly at the kind branch: `run-task-job.ts`
   / `run-note-job.ts` already have siblings for agent-run and delivery.
4. **The status ladder's "one home" rule has a third, undocumented derivation**: `liveTurnStartedAtForEntry`'s global
   pre-resolution window (`use-session-statuses.ts:45-56`) invents `running` from an *absence* (`sessionId === null`)
   — the same shape as the `nodes-screen-invents-needs-you` bug the ONE-RULE decision killed. It is now wrong (A2b).
5. **No invariant test for "a target key is held for exactly the life of its run."** The pool's release path has three
   comments explaining why it *should* hold; nothing asserts it. A `SessionTargetLocks` + tick integration test
   (mirroring my A1 repro) belongs in `delegation-service.test.ts`.
6. **`enqueue-*` writers duplicate the full row literal five times** (~30 fields each). A `buildDelegationJobRow`
   helper would have made A9's missing `thinkingEffort` a type error instead of an omission.
7. **Observability hole for a timed-out-but-running turn.** After A1 the turn has no feed handle, no cancel handle, no
   trace channel end — it is genuinely unobservable. At minimum, log at `error` with the sdk session id.
8. **The voice thread has no durable status anywhere** — no overview entry (§1 verified-clean), so no
   `deriveSessionStatus`, no Sessions row, no Nodes dot, no `needs_input` light if a voice turn parks on a card.
   Given the Voice-chat menu now exists, that is a product gap, not just an internal one.
9. **`mapFrameToBrainEvent` treats a RECOVERABLE `session-errored` as `failed`**
    (`apps/voice/src/brain/run-brain-turn.ts:37-42`) — the daemon announces failure for a transient retry the server
    will recover from. One `isRecoverable` check.

---

## 5. Monitoring binding + node display

**My interpretation:** I answer both readings — (a) the Nodes constellation view specifically, (b) the wider live
truth. (a) is the narrower question; (b) is where the defects are.

### (a) The Nodes constellation — binding is honest, *enlargement* is the weak part

**Binding: good, and deliberately so.** `resolveNodeStatus` (`composables/nodes/node-status.ts:163-179`) is a pure
palette rename of the two real ladders and nothing else — its header records the invented-`waiting` bug it replaced.
Fleet dots read `use-workspace-status`; project dots read `deriveSessionStatus` via `use-session-statuses`
(`use-project-nodes.ts:103-118`). Both levels gate on `hasAnswered` so a loading poll never renders as a claim
(`use-fleet-nodes.ts:32-40`, `use-project-nodes.ts:125-129`). No invented states. One honest self-recorded over-claim:
"The build" wears the *room's* status, so an agent colleague's failure lights it (`use-project-nodes.ts:93-98`).

**Enlargement: structurally blocked at three points.**
1. **`SceneNode` is a 4-field flat record** (`id, name, initials, status`) and `constellation-scene.ts` (787 lines) is
   a ported canvas engine that consumes a flat array with a `SceneLayout`. There is **no level/parent field** — the
   two levels exist only as `drilledProjectId !== null` in `NodesView.vue:56-68` with a `displayNodes` ternary
   (`:70-73`). A third level (project → session → its spawned children / agent runs / tasks) means adding a level to
   that ternary *and* a third id-prefix vocabulary to `message-scene-mapping.ts` (which already hard-codes two:
   `fleetMessages` vs `projectMessages`, `NodesView.vue:76-95`). Nothing generalises.
2. **The id vocabulary is per-level string prefixes** (`continuing:${workspaceId}`, `session:${sessionId}`) parsed by
   `slice()` at the call site (`NodesView.vue:89-92`) and re-decoded in `onNodeClick`. Every new level adds another
   prefix and another decode. A discriminated `SceneNodeRef = {kind:'workspace'|'session'|'job'|'task', id}` would
   make the scene level-agnostic and is a mechanical change.
3. **There is no data source for the deeper levels.** `getSessionsOverview` returns conversations; a session's
   *children* (spawned sessions it created, agent runs, delegation jobs) are only reachable through
   `resolveDelegationTrace` / `listDelegationJobsByThread` — thread-keyed, not parent-keyed, and not exposed as a tree.
   `use-message-edges` polls a 120 s window of edges (`use-message-edges.ts:185-205`) which is the *only* relational
   read the screen has. So "more levels" needs a `GET /sessions/:id/children` (or a tree shape on the overview),
   not just a UI change.

**Perf/scale:** fleet dots come from `useDashboardOverview` polled at 5 s while a turn runs; project dots from the
shared `useSessionsOverview` (capped at 50 entries, server-side sorted before fact composition). Edges poll every 8 s.
Adding nodes adds no sockets — the binding is poll-based and cheap. The canvas engine is the only real per-node cost.
**Verdict:** bindings are correct and *reactive*; enlargement is blocked by (1) a flat `SceneNode` with no hierarchy,
(2) stringly-typed level ids, (3) a missing parent→children read. All three are additive, none is a rewrite.

### (b) The wider live-monitoring binding — one truth, with two leaks and one blind scope

* **One truth, mostly.** `SessionActivityFeed` (in-process registry) → `LiveChannelHub` → one WS per window →
  `activity-store` → `use-session-statuses` (facts × liveness) → `deriveSessionStatus`. `session_turns` is the durable
  mirror written by the same `begin/resolve/end` calls (`session-activity-feed.ts:119-165`), reaped at boot. The
  live-turn registry rides the same socket. That is genuinely one pipe.
* **Leak 1 — voice impersonates global (A2).** Both consequences live here.
* **Leak 2 — the spawned-delegation pre-resolution window (A2b).** `run-delegation-claim-and-run-tick.ts:318-332`
  passes `primarySessionId` but not `sessionId`, so for the engine-spawn seconds it is picked up by the *global*
  entry's fallback.
* **Blind scope — voice has no durable status.** The chain is dropped by `fold-session-chains.ts:69`, so no
  `statusFacts`, no `needs_input` light, no Sessions row, no Nodes dot. Voice liveness exists *only* as a global-scope
  feed frame — which is exactly why A2 bites.
* **Double-derivation check:** clean. `resolveNodeStatus` renames; `SessionRow`, the tree mark and the tab mark all
  render the same two ladders (the recorded follow-up is CSS triplication of the mark idiom, not a third derivation).
* **Delivery/turn ends:** both global sinks stamp `'failed'` on a terminal `session-errored`
  (`global-root-turn.ts:80`, and the drain sink) — the Move-3 feeder fix holds. But an A1-orphaned turn ends its
  envelope `'failed'` at timeout and then keeps running, so `session_turns` records a lie for the remainder.

---

## 6. Session continuity — per runner

| Runner | pressure→swap | carry | checkpoint | auto-continue | whoami/duty | notes |
|---|---|---|---|---|---|---|
| Global web | ✔ `withBoundaryContinuity` (`run-global-root-turn-core.ts:297`) | ✔ | ✔ nudge armed `:231-237` | ✔ `runTurnWithContinuations:103` | ✔ | complete |
| Global channels | ✔ same core | ✔ | ✔ | ✔ (off only for notify turns, `run-global-root-turn.ts:417`) | ✔ | complete |
| **Voice** | ✔ same core, own primary + own lock `${userId}:voice` | ✔ (segments inherit scope) | ✔ | ✔ | ✔ | complete; see below |
| Report/update/direct delivery | ✔ (`withBoundaryContinuity` inside `delegateToWorkspaceRoot`) | ✔ | ✘ by design (`armContextNudge:false`) | ✘ by design + stray checkpoint dropped (`run-report-delivery-tick.ts:398-408`) | ✔ | correct |
| Workspace chat | ✔ `start-chat-turn.ts:250` | ✔ | ✔ `:208` | ✔ `runContinuingTurn` (`chat-turn.ts:360`) | ✔ | complete |
| Spawned DM | ✔ | ✔ | ✔ | ✔ (`session-turn.ts:369`) | ✔ | complete |
| Delegation → workspace-root / spawned / agent | ✔ (`:234 / :256 / :221`) | ✔ | ✔ | ✔ via `enqueueCheckpointContinuation` | ✔ | complete |
| `agent-run` job | ✔ (`run-agent-run-job.ts:225,327`) | ✔ | ✔ | ✔ | ✔ | complete |
| Note delivery | ✔ (rides the task rail) | ✔ | ✘ `armContextNudge:false` | ✘ | ✔ | correct |
| Monitor / schedule / task wake | inherits — they *enqueue* jobs, they never run turns (`run-monitor-tick.ts:189-255`) | ✔ | ✔ | ✔ | ✔ | correct by construction |

**Coverage is genuinely everywhere.** The Slice-1..5 claim holds; I found no runner missing the wrapper.

### Where it can still break

* **C1 · P2 · process-wide registers vs. the ONE thing that outlives the process.** `pending-checkpoints.ts` and
  `swapping-primaries.ts` are `Map`/`Set` module state (`:28-29`, `:10`), documented as deliberate. The consequence
  the docs *don't* name: `beginGenuineTurn` drops a stale checkpoint, so after a restart a mid-checkpoint delegated
  chain resumes as a genuine turn — the model's named "next step" is lost and the runaway guard resets. With
  `MAX_CONSECUTIVE_CONTINUATIONS = 3` and a crash-looping engine that is an unbounded continuation budget in practice.
* **C2 · P2 · the voice no-write rule vs. the swap's copy-forward.** Voice turns never write settings
  (`global-root-turn.ts:338-340`), but the **VoiceChatPanel** *does* PATCH the voice row
  (`use-session-settings.ts` chips over `headSessionId`), and a swap copies settings forward. So the voice chain can
  accumulate a persisted `sessionMode: 'ask'`. Today nothing reads it on the daemon leg (the read is skipped for
  voice, `:150-155`) — so this is a latent trap, not a live bug: the day anyone removes the `!isVoiceTurn` guard,
  hands-free speech starts carding. Worth a comment at minimum, or better: refuse `sessionMode` on a `voice`-scope row
  in `updateChatSessionSettings`.
* **C3 · P2 · concurrency is now real, and the swap is only serialized *per lock key*.** Global and voice share
  `resolveGlobalRootWorkspacePath()` (the same hidden cwd, `resolve-global-root-conversation.ts:42,62`) and both run
  `runSeededSwapSession` there. Two concurrent seeded-swap sessions in one cwd is new since `939cef22`; nothing in
  `run-seeded-swap-session.ts` claims cwd exclusivity. I did not find a concrete corruption, but it is the first time
  two identities can compact in the same directory at the same instant — worth a live smoke.
* **C4 · P2 · mid-turn swap + the DM stream's re-read.** The DM stream re-reads the head after the queue wait
  (`session-turn.ts:265-273`) — correct. But the *interactive global* stream resolves its target **pre-lock**
  (`global-root-turn.ts:141`) for the MCP composition (`composeSessionMcpServers({ sessionId: conversationTarget.primarySessionId })`)
  and re-resolves inside the lock only for the turn (`:357-361`). The primary id is stable across swaps, so this is
  safe today — but the `checkpoint` tool keys on that compose-time primary id, which is why it holds.
* **C5 · P3 · `<synthetic>` / zero usage.** Fixed at the translator (`translate-claude-sdk-event.ts`) per STATE;
  the carry-fidelity floor (`MIN_CARRY_SUMMARY_LENGTH = 60`, `bridge-primary-session.ts:46,166-182`) is the second
  belt and is well placed.
* **C6 · P3 · a timed-out routed turn can swap the primary after its job is failed** (A1's tail): the still-running
  `withBoundaryContinuity` repoints `currentSdkSessionId` while a *second* turn on the same target is mid-flight.

**Improvements:** persist pending checkpoints on `primary_sessions` (a nullable `pending_next_step` + depth) — it is
the one register whose loss is user-visible; add a cwd-scoped guard (or per-identity subdirectory) for seeded swaps
now that two identities share the global ground.

---

## 7. Score — **7 / 10**

| Axis | Score | Why |
|---|---|---|
| Correctness | 7 | The hard invariants (atomic claim, co-committed outbox, chain-scoped status facts, exactly-once catch-up, the voice/global wall in all three server homes) are right and tested. The defects are at the *seams* — the pool's release, the UI's feed vocabulary, one route's surface default. |
| Stuck-resistance | 5 | Background paths are bounded; interactive paths have **no** timeout, and the interactive global path holds a lock the background paths need. S1–S3 are a real cascade with no automatic recovery below a restart. |
| Settings integrity | 7 | The `input ?? row ?? default` rule is one home and honoured; the leaks are three specific omissions (A3, A6, A9) plus two recorded residuals. |
| Observability | 7 | One pipe, durable mirror, boot reap, replay-on-subscribe — genuinely good. Loses points for the voice/global conflation and the invisible orphan turn. |
| Continuity | 8 | Applied on **every** runner with no gaps; clean two-phase op; correct terminal gates and caps. Loses points only for process-scoped registers. |
| Voice | 6 | The thread split is architecturally right and the wall is up server-side. Three real defects (A2, A3, C2) all sit at the seams between the new thread and the old surfaces. |
| Tests | 8 | 2 069-line tick suite, per-runner tests, contract-level status tests, regression tests that pin the *fix's* reasoning. Missing: a lock-lifetime invariant test — which is exactly where A1 lives. |
| Code health | 6 | Comment quality is exceptional (many of my findings came from a comment that no longer matches the code — which is itself a sign of care). But `run-delegation-claim-and-run-tick.ts` at 911 lines and `routes/root/index.ts` at 503 are over the house cap, and the five duplicated enqueue row literals are how A9 happened. |

**+1 point:** fix A1 (hold the lock for the delegate promise), A2 (two lines), A3 (one line) and A6 (stamp the
resolved mode). Four small, local changes that close one single-writer violation, one cross-area UI leak, one
card-less hang and one safety inversion.
**+3 points:** the above **plus** (i) a real per-turn bound — an `AbortSignal` into `startChatSession` so a timeout
stops the *work*, not the waiting, and a `VYNEL_GLOBAL_TURN_MAX_MS` on the root lock; (ii) a DB lease on
`delegation_jobs` (the column exists) so recovery is not boot-only and Phase 2 is reachable; (iii) durable pending
checkpoints; (iv) split the 911-line tick and add the lock-lifetime invariant test.

---

## 8. The VOICE SESSION — review

### End-to-end trace (verified)

```
wake word → apps/voice loop → createBrainClient (brain/run-brain-turn.ts:97-107)
  POST /root/turn { voice:true, model:VOICE_TIER_MODEL, thinkingEffort:'low' }
    → streamGlobalRootTurn (global-root-turn.ts:129-133)
        isVoiceTurn → resolveVoiceConversationTarget (resolve-global-root-conversation.ts:51-64)
          getOrCreateContinuingSession({scope:'voice'})  — own primary, SAME hidden cwd as global
        settings NOT read (:150-155), NOT written (:338-340)
        fitPinnedModelToSession clamp (:181-195)         — the haiku-200k crash class
        activityFeed.begin({scopeKind:'global', origin:'voice'})   ⚠ A2
    → runGlobalRootTurnCore (run-global-root-turn-core.ts:93-94)
        lock `${userId}:voice`                            — concurrent with global ✔
        newSessionOptions scope:'voice', hidden           (:279-282)
        composeGlobalRootProviderMessage(voice:true)      — catch-up SKIPPED ✔
        withBoundaryContinuity + runTurnWithContinuations — full continuity ✔
    ← SSE frames → mapFrameToBrainEvent (run-brain-turn.ts:21-47), returns at session-completed
  reply spoken via the `speak` tool → POST /voice/speak → speakThroughDaemon → daemon TTS
```

**What is right, and worth saying plainly:** the split is the correct architecture — one identity per conversation,
one lock per identity, shared ground and toolset, a separate context window. The server-side wall is genuinely
complete in all three homes (§1 verified-clean). Continuity is free because swap segments inherit scope. The model/effort
pins are now **one home** (`packages/contracts/src/chat/voice-tier.ts`, consolidated in `06781328`) — the recorded
"three pins" concern is **CLOSED**; the call leg and the web overlay both import the same constants.

### Where it breaks / can break

| # | Issue | Severity |
|---|---|---|
| A2 | Voice impersonates the global primary on the feed → the Global chat can render the voice transcript; the Assistant row reads `running` | **P1** |
| A3 | The CALL leg runs in `ask` — a card-less surface parks for 10 min | **P1** |
| C2 | The Voice-chat panel can persist `sessionMode` onto the voice row — inert only because of one `!isVoiceTurn` guard | P2 |
| V1 | The voice thread has **no** durable status anywhere (dropped by `fold-session-chains.ts:69`) — a parked voice card produces no `needs_input` light on any surface | P2 |
| V2 | `mapFrameToBrainEvent:37-42` reports a **recoverable** `session-errored` as `failed` — the daemon announces failure for a retry the server recovers from | P3 |
| V3 | `streamTurnEvents` returns at `session-completed` and destroys the response body; the server's boundary swap then runs against a dead socket. Correct by design (writes no-op), but it means the *only* observer of a voice swap is the server log | P3 |
| V4 | The Voice-chat panel pins model+effort as `settings-defaults` but **not mode** (`VoiceChatPanel.vue:199-203`) — a typed voice turn inherits the user's global chip, so it can card while its reply is being spoken | P3 |

**Double-speak / wrong-speak:** the relay's single-delivery discipline is careful and correct — `state` broadcasts,
`wake`/`speak` go to the **newest** listener only, one upstream per surface, replay-on-late-subscribe
(`voice-daemon-relay.ts:12-21`). `speak` is `rootSurface: true`, so the *global* root can also speak — deliberate, and
it means the four-party ownership question is resolved outside the session layer. I found no double-delivery path.

### Judging the recorded open forks

1. **`direct_to_user` reaches only the global catch-up net** — *right call to defer, wrong framing.* A voice-only user
   never hearing a direct answer is a symptom; the cause is that the voice thread has no inbox and no status (V1). Fix
   V1 first (give the voice chain an overview entry / a status), then absorption or a spoken notice is a small
   addition on top. **Rank: 3rd.**
2. **Voice-fired TASKS parent on the global conversation** — *right call, leave it.* Kafi's model ("voice shows under
   global") makes global holding the work ledger coherent, and it is the *only* thing that keeps a voice-fired task
   visible at all given V1. Re-plumbing before V1 would make voice tasks invisible. **Rank: 5th (do not do yet).**
3. **Split the 503-line `routes/root/index.ts`** — *right, and it is the cheapest item on the list*, but it is
   hygiene, not risk. **Rank: 4th.**
4. **Per-call sessions gain the routing toolset** — *do not do this until A3 is fixed.* Giving a card-less `ask`-mode
   call session more mutating tools multiplies the hang surface. Order matters: A3 → toolset. **Rank: after A3.**

**My ranking of voice next moves:** A3 (one line, unblocks the call arc) → A2 (two lines, closes the UI half of the
wall) → V1 (give the voice chain a status; unblocks fork 1) → routes split → C2 guard → fork 4.

---

## Top 10 ranked

| # | ID | Sev | One line | Where | Conf |
|---|---|---|---|---|---|
| 1 | **A1** | P1 | Routed-turn timeout releases the target lock while the SDK turn is still live → two writers on one session + an invisible orphan turn | `run-delegation-claim-and-run-tick.ts:812-833`; `delegation-service.ts:204-225` | CONFIRMED (repro) |
| 2 | **A4** | P1 | One parked `ask_user` on the global chat wedges the whole `${userId}` root lock — channels + report deliveries stall, then deliveries time out `failed` and drop out of every net | `root-turn-lock.ts:24-32`; `global-root-turn.ts:209-211`; `run-report-delivery-tick.ts:430-437` | CONFIRMED |
| 3 | **A2** | P1 | A voice turn's feed frame is indistinguishable from a global-primary turn → the Global chat can bind/render the VOICE thread; Assistant row falsely `running` | `global-root-turn.ts:321-325`; `activity-store.ts:61-77`; `use-session-statuses.ts:51-56` | CONFIRMED (repro) |
| 4 | **A3** | P1 | The voice CALL leg runs its per-call session in `ask` mode — a floor tool parks a live call for 10 min | `call-session-client.ts:33-37`; `session-turn.ts:90` | CONFIRMED |
| 5 | **A6** | P2 | Mode inversion: a mode-less interactive turn runs `ask` but stamps no header, so its children run bypass-with-behavior-gate | `chat-turn.ts:119,176-177`; `session-turn.ts:90,104-107` | CONFIRMED |
| 6 | **A5** | P2 | A parked approval does not suspend the delivery budget on the GLOBAL branch (it does on the workspace branch) | `run-report-delivery-tick.ts` global branch; `build-routed-approval-handler.ts:65-68` | CONFIRMED |
| 7 | **A9** | P2 | `@agent` colleague runs never inherit thinking effort (personas do) — contradicting the interface's own doc | `enqueue-agent-run.ts:26-56`; `composer-mention-turn.ts:190-194` vs `:215-219` | CONFIRMED |
| 8 | **K1** | P2 | The model-fit guard is wired on the voice leg only — a delegated small-model pick onto a fat primary is the same "Prompt is too long" class | `global-root-turn.ts:182-195` (only site); `delegate-to-spawned-session.ts` | CONFIRMED |
| 9 | **A8** | P2 | The global SSE stream never emits `turn-queued{busy}` — a queued global send just looks frozen (and under A4, forever) | `global-root-turn.ts:345-347` vs `session-turn.ts:255-262` | CONFIRMED |
| 10 | **V1** | P2 | The voice chain has no overview entry → no `deriveSessionStatus`, no Sessions row, no Nodes dot, no `needs_input` light when a voice turn parks | `fold-session-chains.ts:68-69`; `run-global-root-turn-core.ts:279-282` | CONFIRMED |

*Dropped from the top 10 after verification:* **A7** — the fail-open unpersisted-approval branch is real but its
trigger is unreachable with today's provider (`run-claude-chat-session.ts:227-280`); kept in §1 as a latent invariant.

## Score

**7 / 10.** Rubric and the +1 / +3 paths are in §7.
