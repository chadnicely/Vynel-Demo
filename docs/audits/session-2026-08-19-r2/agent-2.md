# Session-system audit — round 2, agent 2 (global root + voice entry point)

Worktree `E:/KLONE/Workspace/vynel/.claude/worktrees/session-audit`, branch `feature/session-audit`
@ `71dbe151` (= main, the merge of the session-hardening arc). Audit-only; no source edits left
behind. Every path is worktree-relative.

**Method.** Round-1 closure first (every P1 + every Tier-A item re-read at its current line), then the
arc note's own §6/§7 confessions verified against code (the lead's hand-folded merge fixes are the
least-reviewed code in the tree), then the two post-review commits (`55a29bfc`, `6a115b95`), then the
new surfaces (wall clock, lease/sweeper, durable checkpoints, voice watchdog). Docs were treated as
claims; **code won** every time they disagreed — and they disagree in three places worth reporting.

**Legend.** `CONFIRMED` = traced hop-by-hop in this checkout (or reproduced). `PLAUSIBLE` = the code
reads that way but a live seam was not exercised. Severity P0 blocker / P1 major / P2 minor / P3 nit.

---

## 0. Headline

The arc did what it said on the two structural classes that dominated round 1 — **the delegation lock
now lives as long as the run** (L1 closed at the coordinator, not patched at the pool), and **every
human-wait has a bound and an owner** (pausable timeout → hard cap, wall clock, ask timer + reaper,
lease + sweeper). Those are real, well-shaped, single-home fixes; the CAS-on-claim follow-up
(`55a29bfc`) closes the door the lease sweeper opened rather than leaving it ajar. Voice is
transformed: tier forced server-side on every leg, own feed scope, own status door, identity-shaped
Stop, a daemon watchdog.

What is left is **three places where the arc note reads better than the code** — schedule fires are
still on the retired unattended default (an unowned surface §2 assumed covered), the E3 overlay
de-dup drops far more than "its own live turn", and the restart-mid-checkpoint resume needs the user
to speak again — plus **one regression the identity stamping introduced in a reader nobody
re-checked** (the working rail), **one concurrency hole the call-leg watchdog opened after both
reviewer passes**, and the structural residue the arc deliberately did not schedule (unbounded lock
queues, the nodes screen's invented progress, a session-children door with no consumer).

**Score: 8.5 / 10** (round 1: 7). Full rubric in §7.

---

## Round-1 P1 closure table

| ID | Round-1 finding | Verdict | Evidence at HEAD |
|---|---|---|---|
| **L1** | Delegation timeout releases the target lock under a live turn | **CLOSED** | `route-request.ts:99-156` — the cap only pulls `onHardCap`; the coordinator still `await`s the delegate and returns `capped` whatever it settles to. `run-delegation-claim-and-run-tick.ts:159-167` runs the whole job inside the claim; `delegation-service.ts:188-209` releases the key in the run promise's own `.finally`. Regression test present (`route-request` cap suite). |
| **V1** | Voice CALL leg runs `ask` | **CLOSED** | `call-session-client.ts:44-50` sends `{ mode: VOICE_TIER_MODE, voice: true }`; enforcement is server-side and unconditional — `session-turn.ts:106-112` → `interactive-turn-settings.ts:67` returns the tier without reading the row, `:303` skips the write-through, `:85-97` fit-clamps. |
| **V2** | Voice turn announces `scopeKind:'global'` with no `primarySessionId` | **CLOSED** | `global-root-turn.ts:334-339` — `scopeKind: isVoiceTurn ? 'voice' : 'global'` **and** `primarySessionId: conversationTarget.primarySessionId` on every global turn. The background runner stamps it too (`run-global-root-turn.ts:404-413`). |
| **V3** | Voice chain never enters the overview → no status anywhere | **CLOSED** | `fold-session-chains.ts:72-73` admits `tail.scope === 'voice'`; `get-sessions-overview.ts:44-47` drops it from every agent-visible read; `getVoiceChatOverviewEntry` (`:85-94`) is the Voice surface's own door behind `GET /root/voice-chat/status` (`routes/root/voice-chat.ts:104-121`). |
| **W1** | Card-less surfaces park unbounded (voice, channels, delivery) | **PARTIAL** | Voice: `ask_user` not attached (`global-root-turn.ts:217-227`), tier mode `auto` → the floor stands down (`tool-approval-policy.ts:108`). Channels: `?? DEFAULT('auto')` (`run-global-root-turn.ts:266-267`) + 10-min ask. Delivery: requester-row mode, cap suspends on park. **Schedules were NOT converted** — `fire-schedule.ts:139` still hardcodes `bypass-with-behavior-gate`, which still cards the floor (`tool-approval-policy.ts:109-111`). See **R2-01**. |
| **G1** | One parked ask wedges the `${userId}` root lock; deliveries burn budget and fail | **CLOSED (with a residual)** | Ask is bounded by its own timer (`ask-user-tool.ts:125-146`) + a 60 s reaper (`asks-recovery-service.ts:37-52`); the interactive wall clock bounds the holder (`global-root-turn.ts:371-396`); a global delivery that meets a busy root lock now **yields its slot** instead of burning it (`run-report-delivery-tick.ts:279-291`); a capped delivery requeues (`:530-549`). Residual: the wall clock is suspended while parked, so worst-case hold = 2 h ask + 60 min work (**R2-08**). |
| **G2** | Catch-up marked surfaced before `startChatSession` | **CLOSED** | `run-global-root-turn-core.ts:260-271` + `markCatchUpSurfacedOnSessionStarted` (`:344-356`) — the mark fires on the first `session-started` frame, and a failed mark only re-injects (never loses). |
| **V4** | Voice-panel Stop interrupts the GLOBAL primary | **CLOSED** | `routes/root/interrupt.ts:59-81` takes an owner-checked `sessionId` restricted to `INTERRUPTIBLE_SCOPES = {global, voice}` (`:34`); 404 on unknown/foreign/out-of-scope. Reviewer fold: a voice surface with no known session sends nothing (verified in the web layer, §5b). |
| **M1** | Fit guard has one caller | **CLOSED** | `fitPinnedModelToSession` now has four production callers: `interactive-turn-settings.ts:85` (all three interactive streams), `run-global-root-turn.ts:270` (channels + deliveries on the global root), and `resolve-background-turn-settings.ts:77` — which is the ONE home used by `run-task-job.ts:207`, `run-agent-run-job.ts:207` and `run-report-delivery-tick.ts:397`, i.e. every delegated/agent-run/notify model pick, `agent.model` fallback included (`run-task-job.ts:210`). |

### Round-1 P2s worth calling

| ID | Verdict | Evidence |
|---|---|---|
| S1 (no lease · unbounded `acquire` · no root-lock deadline · no wall clock) | **PARTIAL** | Lease + heartbeat + 60 s sweeper landed (`delegation-jobs.ts:198-233`, `delegation-lease-heartbeat.ts`, `delegation-service.ts:133-139`). Wall clock landed on all three interactive streams. **`SessionTargetLocks.acquire` is still unbounded and uncancellable** (`session-target-locks.ts:28-35`) and `runUnderRootTurnLock` still has no queue bound (`root-turn-lock.ts:41-57`). See **R2-06**. |
| S2 (`turn-queued{busy}`) | **CLOSED** | `global-root-turn.ts:401-406` via `isRootTurnLockBusy(rootTurnLockKey(...))`; the daemon speaks "One moment" once per turn (`voice-session-driver.ts:297-302`). |
| V5 (voice auto-continue) | **CLOSED** | `global-root-turn.ts:444-446` passes `autoContinue: false` on the voice leg. |
| V6 (`onSpeak` handed-off no-op) | **PARTIAL** | Daemon half landed (`main.ts:156-162`); web half landed (`use-voice-daemon-link.ts:79`) but its predicate is session-lifetime, not turn-lifetime → the drop it was meant to remove is still there. See **R2-02**. |
| V7 (typed vs spoken settings) | **CLOSED** | Server forces the tier on `voice: true` for both doors; `updateChatSessionSettings` 403s a `voice` row; panel chips read-only. |
| T1 (mode inversion / default asymmetry) | **CLOSED** | All three streams stamp the resolved mode unconditionally (`chat-turn.ts:189`, `session-turn.ts:123-125`, `global-root-turn.ts:183`); `DEFAULT_SESSION_MODE = 'auto'` is the single fallback (`session-mode.ts`). |
| T2 (spawned/agent/leaf born NULL) | **PARTIAL (by decision)** | Spawned: birth-stamped (`routes/sessions/index.ts:91-105`, `:339-343`). Leaf: `record-leaf-session.ts` still writes none — §7-deferred, and behaviourally covered by A5. |
| T3 (agent-run effort / follow-up origin) | **CLOSED (effort) / deferred (origin)** | `enqueue-agent-run.ts:57-60,106` carries `thinkingEffort`; `composer-mention-turn.ts:196-197,221-222` passes it on both branches. `origin` deferred per §7 (no live caller). |
| T4 (`autoBuildout` read by nobody) | **CLOSED for 4 of 5 surfaces** | Global (`global-root-turn.ts:437-439`), workspace (`chat-turn.ts:331-333`), spawned DM (`session-turn.ts:347-349`), channels (`run-global-root-turn.ts:283,448`), delegated (`resolve-background-turn-settings.ts:100`). **Schedule fires resolve it nowhere** — same site as R2-01. |
| C1 (process-wide checkpoint register) | **CLOSED (with a caveat)** | `pending-checkpoints.ts` is DB-backed on `primary_sessions`. Caveat: nothing *resumes* a survivor until the identity's next genuine turn — see **R2-03**. |
| D1 (delivery rail) | **CLOSED** | Global branch marks the gate (`run-global-root-turn.ts:543-553`); capped delivery is recoverable (`run-report-delivery-tick.ts:540-548`); idempotent inbound (`consume-session-event-stream.ts:156-179`, `handle-session-started.ts:164,209`, stable id = the job id). |
| D2 (restart destroys note/direct rows) | **CLOSED** | `ORPHAN_REQUEUE_JOB_KINDS = ['report-delivery','direct-delivery','note']` (`delegation-jobs-recovery.ts:29`), one policy for boot AND lease sweep. |
| N1/N2/N3/N4 (nodes) | **MOSTLY CLOSED** | Scoped project read, `hasAnswered` at fleet level, id-keyed slot inheritance, count-aware layouts, `SceneNodeRef` union + level stack. Residuals in §5a. |

---

## 1. Bugs — all scopes

### R2-01 · P1 · schedule fires · **Scheduled turns still run the retired `bypass-with-behavior-gate` and still card the floor** · NEW (an UNOWNED gap §2 assumed closed)

**Where** `packages/schedules/src/firing/fire-schedule.ts:139`.

```ts
permissionMode: 'bypass-with-behavior-gate', // D10
```

**Evidence.** D3 is *"`DEFAULT_SESSION_MODE` → `auto` for everything"*, and §2 of the arc note lists
the consequence among the lead's stated assumptions: *"Delivery / update / direct / note turns **and
schedule fires** resolve the requester row's mode `?? DEFAULT` (D3) — no more hardcoded
NULL→unattended."* Every other surface was converted (`run-global-root-turn.ts:266-267`,
`resolve-background-turn-settings.ts:69-73`, `run-global-root-turn-core.ts:210`,
`interactive-turn-settings.ts:71`). The schedule fire was not — and fairly: **no slice in §3 owns
`packages/schedules/**`**, so this is an unowned gap the assumption list treated as covered, not a
slice that shipped short. It is still live behaviour, and it is the one surface where it matters most.

**The literal is not dead.** `startChatTurn` — the one runtime file every non-global path goes
through — forwards `permissionMode` verbatim with no re-resolution:
`packages/session/src/runtime/start-chat-turn.ts:198` `permissionMode: input.permissionMode,`
inside `provider.startChatSession({...})`. So the hardcoded value reaches the provider unchanged.

And `bypass-with-behavior-gate` is the one mode where the static floor still cards:

```ts
// packages/providers/src/claude/approvals/tool-approval-policy.ts:109-111
if (mode === 'bypass-with-behavior-gate') {
  return isAlwaysCardTool(toolName, sets) ? 'card' : 'allow'
}
```

with the floor = Bash / Write / Edit / NotebookEdit (`tools-always-requiring-approval.ts`).

**The card really records and really parks** (the other half of the claim, traced): the fire passes a
real `workspaceId` (`fire-schedule.ts:133`) and the turn gets a session row, so
`handleApprovalRequested` takes the persisting branch (`handle-approval-requested.ts:43,63-78`) rather
than the forward-without-persisting one — the provider's `canUseTool` promise stays parked until the
row resolves. Nothing in the schedule path passes an approval handler, so the only resolver is the
user's desktop toast or the reaper, which denies at `requestedAt + timeoutMs * 2`
(`packages/approvals/src/requests/recover-stale-pending-approvals.ts:68`) on a 60 s tick
(`approvals-recovery-service.ts:15,28-37`).

**Failure scenario (concrete).** A user schedules "every morning, update the changelog and push".
3 a.m. fires. The turn calls `Write` → `canUseTool` cards → parks. The turn stalls ~10 minutes, is
denied with the timeout steer, tries `Bash` → another ~10 minutes, and finally reports a half-done
job. The schedule fire is the *most* unattended surface in the product, it has no wall clock of its
own, and it is the last one on the carding unattended mode. `autoBuildout` (autopilot) also never
reaches it.

**Minimal fix.** Resolve like every sibling: read the target workspace's primary head row and pass
`resolveBackgroundTurnSettings`-shaped `job(null) ?? row ?? DEFAULT_SESSION_MODE`; at minimum change
the literal to `toPermissionMode(DEFAULT_SESSION_MODE)`. `askModeApprovalToolNames` is already
forwarded (`:152-155`) for exactly this eventuality. **CONFIRMED** — traced literal → `startChatTurn`
pass-through → `decideCanUseTool` floor → `handleApprovalRequested` persisting branch → reaper bound.

---

### R2-02 · P2 · voice (overlay) · **The E3 overlay de-dup drops every relayed `speak` for the whole overlay session, not just its own live turn** · NEW (the coupled fix is half-effective)

**Where** `apps/local-web/src/views/JarvisView.vue:30` and
`apps/local-web/src/components/voice/VoiceOverlay.vue:23`:

```ts
isPlayingOwnTurn: () => voice.isActive.value,
```

and `apps/local-web/src/composables/voice/use-voice-session.ts:76`:

```ts
const isActive = computed(() => view.value.state !== "ended");
```

The session view's states are `listening | thinking | speaking | ended`
(`voice-command-session.ts:87,102,131,152`). So `isPlayingOwnTurn()` is **true from the moment the
overlay session starts until it ends** — including the long `listening` stretches between turns.

**Evidence of the intent it misses.** `use-voice-daemon-link.ts:35-40` documents it as *"True while
THIS window's own overlay session is live … a schedule's or the Voice-chat panel's speak that lands
mid-conversation is dropped with it"* — but §7 of the arc note claims the opposite outcome: *"a
schedule / panel / delivery `speak` during an overlay conversation is **played** instead of silently
dropped; only one landing inside the overlay's own live turn is still dropped (today ALL are)."*

**Failure scenario.** `VYNEL_VOICE_JARVIS_WINDOW` defaults to `'1'` and
`shouldHandOff: () => jarvisEnabled || overlay.hasClient` (`main.ts:235`), so **every** wake hands
off. During that conversation a scheduled task finishes and calls `speak`. Daemon: handed-off →
`overlay.publishSpeak(text)` returns true → logged as "handed to the overlay that owns the session"
(`main.ts:157-158`). Browser: `event.kind === 'speak'` → `isPlayingOwnTurn() === true` (the user is
merely listening) → `return` (`use-voice-daemon-link.ts:79`). The line is dropped on both sides and
logged as delivered on one. Net behaviour is the **pre-arc no-op**, relocated.

**Minimal fix.** Pass a turn-lifetime predicate, not a session-lifetime one:
`isPlayingOwnTurn: () => voice.view.value.state === 'thinking' || voice.view.value.state === 'speaking'`
(two call sites). **CONFIRMED** (traced daemon → relay → composable → predicate).

---

### R2-03 · P2 · continuity (all scopes) · **A checkpoint that survives a restart is not resumed — it waits for the user's next message, with nothing on screen saying so** · PARTIAL vs the arc's claim

**Where** `packages/session/src/runtime/run-turn-with-continuations.ts:80-86` and
`packages/session/src/continuity/pending-checkpoints.ts:128-134`.

```ts
const survivor = beginGenuineTurn(db, primarySessionId)   // run-turn-with-continuations.ts:80
if (survivor !== null) { logger.info(..., 'a pending checkpoint survived from before this turn — it continues after it') }
```

The survivor is read, **left on the row**, and continued only *after* the next genuine turn finishes.
There is no boot pass over `primary_sessions.pending_checkpoint_next_step`, and nothing surfaces the
pending state to the client (contracts carry no `ChatTurnEvent` for it — §7 records the drop-note as
persisted-row-only, and the *pending* state has no representation at all).

**Evidence of the gap.** §3 G1 promises *"a restart mid-checkpoint **resumes** the continuation
instead of silently dropping it"*. What ships is "does not lose it". For the DELEGATED half this is
genuinely self-healing (the follow-up job row is `pending` in `delegation_jobs` and the pool claims it
after boot). For the **interactive** half — the global brain, a workspace chat, a spawned DM — nothing
runs until the user types again.

**Failure scenario.** Global brain checkpoints at 0.9 occupancy mid-way through a long piece of work;
the app is restarted (an update, a crash). Vynel is silent and idle; the Sessions row shows `idle`;
the work resumes only when the user next says something, and then only *after* whatever they said.
Kafi's live smoke ("a restart mid-checkpoint continues") passes only if he sends a message afterwards.

**Minimal fix.** Either (a) a boot pass that lists identities with a pending, job-less checkpoint and
enqueues one continuation each, or (b) — cheaper and honest — surface it: a `needs_input`-adjacent
fact or a persisted note row at boot ("Paused mid-task after a restart — next: …"). Today the state is
invisible. **CONFIRMED** (read the only two readers of the slot).

---

### R2-04 · P2 · voice (live call) · **The call-leg watchdog can drop the very reply it promises, and can start a second turn while the first is still speaking** · NEW (introduced in `55a29bfc`, after both reviewer passes)

**Where** `apps/voice/src/call/call-conversation.ts:200-252`, `#speak` at `:287-304`,
`LineSpeaker.speakLine` at `packages/voice/src/relay/line-speaker.ts:52-55`.

```ts
// line-speaker.ts:52-55
if (this.#speaking) {
  throw new Error('speakLine while a line is in flight — the caller must serialize speech')
}
```

```ts
// call-conversation.ts:213-222
const watchdog = armTurnWatchdog(this.#deps.turnWatchdogMs)
void watchdog.whenExpired.then(async () => {
  if (handedBack || this.#stopped) return
  ...
  if (speakPolicy === 'always') await this.#speak(CALL_TURN_STILL_WORKING_LINE)
  handBack()                        // #turnInFlight = false; #runPendingWork()
})
```

`runCallTurn` takes **no abort signal** (`call-session-client.ts:41-51`), so unlike the wake-line
watchdog (which aborts the read, `voice-session-driver.ts:259-270`) the call turn keeps streaming
after the room is handed back. Its reply then lands in `await this.#speak(spoken)` (`:247`).

**Two concrete failures.**

1. **Race at the boundary.** The watchdog callback checks `handedBack`, which is only set in the
   `finally` (`:249-251`) — i.e. *after* `#speak(spoken)`. If the watchdog fires while turn #1 is
   already speaking its answer, `#speak(CALL_TURN_STILL_WORKING_LINE)` runs concurrently →
   `speakLine` throws → caught and logged at `:296-300` → "still working" is silently lost. Harmless.
2. **The load-bearing one.** After hand-back, `#runPendingWork()` (`:211`) may immediately start
   turn #2 (`#pendingRespond`) or a conductor `speakDirect` line (`:271-274` — `speakDirect` at `:99`
   only checks `!this.#turnInFlight`, which is now false). When turn #1's late reply arrives, if
   turn #2 or the direct line is mid-`speakLine`, turn #1's reply throws and is **dropped with an
   error log** — the exact opposite of the file's own promise at `:35-37`: *"the reply is still
   spoken when it lands (the call leg reads its answer off the stream — abandoning the read would
   lose it, so it is never abandoned)"*.

**Minimal fix.** Make `#speak` serialize instead of throwing — a single-flight speech queue on the
conversation (the `VoiceSessionDriver.#speakQueue`/`#drainSpeakQueue` shape already exists, one file
over) — or make `#speak` await an in-flight line before starting. Either removes both failures.
**CONFIRMED by code trace** (LineSpeaker's guard is an unconditional throw; `#speak` swallows it).

---

### R2-05 · P2 · all delegated scopes · **A machine that sleeps lets the lease sweeper reap live runs** · PLAUSIBLE (design-level, desktop-specific)

**Where** `apps/local-api/src/services/delegation-service.ts:133-139` (60 s sweep),
`packages/session/src/delegation/delegation-lease-heartbeat.ts:24-39` (30 s beat),
`packages/orchestration/src/repositories/delegation-jobs-recovery.ts:37-45`
(`leaseExpiresAt <= now` ⇒ orphan).

The lease is 3 min and the heartbeat 30 s, with an env guard that heartbeat ≤ lease/2
(`apps/local-api/src/env.ts:186-194`) — correct for a server. Vynel is a **desktop app**: a laptop
lid-close suspends timers wholesale. On resume, the sweeper's first pass sees every in-flight claim's
`leaseExpiresAt` in the past and settles them by kind *while their runs are still live in-process*.

**What happens then** (this is the part `55a29bfc` got right, and why this is P2 not P1): the terminal
writers are a CAS on `status='claimed'` (`delegation-jobs.ts:310-316, 327-338`), so the live run's
completion returns `null` and stands down with a warn (`settle-completed-task.ts:109-117`). No
double-write. But for a **work** kind the user gets *"The background task … was interrupted when its
run stopped responding"* (`delegation-orphan-settlement.ts:50-53`) plus a failure delivery, while the
task actually completes moments later and its result is discarded. For a **message** kind the row
requeues and the delivery runs a second time — idempotent on the inbound row
(`insertChatMessageIfAbsent`) but a second provider turn on the requester's conversation.

**Minimal fix.** Make the sweeper skip claims this process still owns: the tick already knows its live
job ids (the heartbeat handle). A one-line in-process guard set (`liveJobIds`) passed into
`settleOrphanedDelegationClaims` closes the whole class without touching the DB semantics.
**PLAUSIBLE** — the code path is certain; the suspend behaviour is not exercised here.

---

### R2-06 · P2 · all interactive scopes · **The lock queues themselves are still unbounded and uncancellable; the wall clock only bounds the holder**

**Where** `packages/session/src/delegation/session-target-locks.ts:28-35` and
`packages/session/src/runtime/root-turn-lock.ts:41-57`.

```ts
// session-target-locks.ts:28-35 — no deadline, no cancel handle
acquire(targetKey: string): Promise<() => void> {
  const waiters = this.waitersByKey.get(targetKey)
  if (waiters === undefined) { this.waitersByKey.set(targetKey, []); return Promise.resolve(this.buildRelease(targetKey)) }
  return new Promise((resolve) => waiters.push(resolve))
}
```

The wall clock is armed **after** acquisition, by design and correctly:
`global-root-turn.ts:417-422` arms it inside `resolveTarget`, which the core calls as its first
in-lock statement; `chat-turn.ts:402` and `session-turn.ts:419` arm after `locks.acquire`. So queue
time is charged to nobody. Round-1 stuck-point #7 records that a client disconnect does **not** cancel
a queued waiter (deliberate, `session-turn.ts:506-517`), so the queue can hold dead waiters.

**Failure scenario.** Three tabs (or a tab + Telegram + a mention dispatch) send into the global root
while one turn is wedged on a genuinely slow provider. Worst case each holder burns
`VYNEL_INTERACTIVE_TURN_MAX_MS` (60 min default) in turn: the last waiter starts 3 hours later, and
its user closed the tab 2h50m ago. Nothing is corrupt — but nothing is bounded end-to-end either, and
`isRootTurnLockBusy` only tells the composer it is waiting, never for how long or behind how many.

**Minimal fix (small).** A depth read (`rootTurnCountByLockKey` already exists,
`root-turn-lock.ts:22`) on the `turn-queued` frame — `{ reason: 'busy', ahead: n }` — so the composer
can say something true. **Minimal fix (real).** An `AbortSignal` on `acquire` so a detached client's
waiter drops out of the FIFO; the deliberate "queued means will-be-delivered" contract can stay for
the *session-turn* path and be dropped for the global one, where nothing is persisted until the turn
starts. **CONFIRMED** (both lock implementations read end to end).

---

### R2-07 · P3 · all scopes · **The wall clock cannot interrupt a turn whose session id it does not know yet**

**Where** `packages/session/src/runtime/turn-wall-clock.ts:113-143`.

```ts
if (input.sessionId === undefined) return failure     // :125 — no failure row, no interrupt
```

The three streams hand it `turnSession.current()` (`global-root-turn.ts:381`, `chat-turn.ts:410`,
`session-turn.ts:427`). That is `undefined` until the first `session-created` /
`user-message-persisted`. On a **fresh** conversation (no `resumeSessionId`) the durability-first
early write is skipped (`consume-session-event-stream.ts:148`), so the id only arrives after the
provider's `session-started`. The window is bounded in practice — provider startup has its own
deadline (`run-claude-chat-session.ts:177-199`, `provider_start_timeout`) — and the file says so
(`:92-94`). But if the clock *does* fire in that window (a tiny `VYNEL_INTERACTIVE_TURN_MAX_MS` in a
smoke, or a provider that answers `session-started` and then hangs before the consumer yields), the
client gets a `session-errored` frame while the provider keeps running and the lock stays held until
it finishes on its own. **CONFIRMED** by reading the early-return; the trigger is narrow.

**Minimal fix.** Fall back to the pre-resolved head the stream already has
(`session-turn.ts` has `resumeSessionId`; `global-root-turn.ts` has
`conversationTarget.resumeSdkSessionId`) before giving up.

---

### R2-08 · P3 · global · **A parked ask can hold the root lock for 2 h + 60 min of work**

**Where** `apps/local-api/src/env.ts:76,80` (`VYNEL_INTERACTIVE_TURN_MAX_MS` 3 600 000,
`VYNEL_INTERACTIVE_ASK_MAX_MS` 7 200 000) and `pausable-timeout.ts:38-41` (parked time is subtracted,
by design — decision D5).

That is the intended semantics ("working time, never deciding time"), and the delivery rail no longer
burns budget behind it (`run-report-delivery-tick.ts:279-291` yields). But nothing bounds the
*wall*-wall: an ask nobody answers holds `${userId}` for 2 h, and Telegram/Discord turns for that user
queue behind it the whole time with no signal. Worth an explicit product decision rather than a code
change. **CONFIRMED** (arithmetic over the two knobs and the suspend rule).

---

### R2-09 · P3 · continuity · **A checkpoint handed to a follow-up job that never claims leaks its slot silently**

**Where** `packages/session/src/continuity/pending-checkpoints.ts:51-60` (`pendingOf` filters any row
with `pendingCheckpointJobId !== null`) and the single consumer
`takeContinuationJob` ← `beginDelegatedTurn` (`enqueue-checkpoint-continuation.ts:74`).

If the follow-up job dies before it is claimed — boot orphan reap
(`failOrphanedClaimedDelegations`), lease sweep, or a user Stop on the pending row
(`failPendingDelegationJob`) — nothing ever calls `takeContinuationJob(jobId)`. The slot stays
"handed over" forever: invisible to `peek`/`take`, so no drop note is ever written and no continuation
runs. It self-heals only when the identity's *next* checkpoint overwrites it
(`markPendingCheckpoint` sets `pendingCheckpointJobId: null`, `:83`). For the reap paths the user at
least gets a failure delivery; for a **user Stop** on the pending follow-up they get neither the
continuation nor the note. **CONFIRMED** by call-site census (`grep takeContinuationJob` → one caller).

---

### R2-10 · P3 · global/voice · **`interruptTurn` answers `interrupted: true` without checking that anything was interrupted**

**Where** `apps/local-api/src/routes/root/interrupt.ts:72-73`.

```ts
await interruptChatSession(DEFAULT_PROVIDER_ID, namedSessionId)
return c.json({ interrupted: true })
```

The named session is validated for ownership and scope but not for *liveness*. A client holding a
pre-swap segment id (the chain head moved mid-turn) gets a confident `true` while the running session
keeps going. The id-less branch (`:76-80`) is more honest (`interrupted: false` when there is no
head). Low impact — the client's own stream ends anyway — but the Stop control's truthfulness is
exactly what round 1 flagged. **CONFIRMED**.

---

### R2-11 · P1 · monitoring (all scopes) · **The working rail broke when global turns started naming their primary — every global/voice turn now rails as a nameless "Working…" session chip whose click 404s** · NEW REGRESSION · REPRODUCED

**Where** `apps/local-web/src/composables/activity/use-working-rail.ts:127-160`.

```ts
for (const turn of serverTurns) {
  if (turn.primarySessionId != null) {            // :128
    upsert({ kind: "session", key: `session:${turn.primarySessionId}`,
             label: turn.personaName ?? "", segmentId: turn.sessionId ?? null, ... })
  } else if (turn.scopeKind === "workspace" && turn.workspaceId != null) { ... }
  else if (turn.origin !== "web") {               // :150 — the BRAIN row
    upsert({ kind: "brain", key: "brain", label: "Claude", ... })
  }
}
```

**Why it broke.** The file's own header states the contract it was written to (`:12-15`):
*"the BRAIN rails for its non-web background turns (a Telegram reply, a schedule fire … **your own web
turn is the thread you're already looking at, so it never rails**)"*. That held only because global
turns used to carry **no** `primarySessionId`. Slice C3 changed exactly that
(`apps/local-api/src/streams/global-root-turn.ts:337` and `apps/local-api/src/sessions/run-global-root-turn.ts:410`),
so the first branch now swallows every global turn — and every voice turn — before the brain branch
can be reached. `use-working-rail.ts` sits inside `composables/activity/**`, which slice D owned, and
neither reviewer pass caught it. This is the exact hazard D wrote down in the mirror image ("if
workspace turns ever start stamping it, workspace binding silently stops working") — it happened on
the global side instead.

**Reproduced.** Throwaway vitest against the exported pure builder
(`npx vitest run --project local-web`, 4/4 green; file deleted afterwards):

| input turn | result today | result on the pre-arc wire |
|---|---|---|
| `{scopeKind:'global', origin:'web', primarySessionId:'global-primary-1', sessionId:'sdk-seg-1'}` | one `kind:'session'` row, `label:''`, `segmentId:'sdk-seg-1'` | *(nothing — `origin === 'web'`)* |
| `{scopeKind:'global', origin:'telegram', primarySessionId:'global-primary-1'}` | `['session']`, no `brain` row | `['brain']` (asserted) |
| `{scopeKind:'voice', origin:'voice', primarySessionId:'voice-primary-1', sessionId:'voice-seg-1'}` | one `kind:'session'` row pointing at the hidden voice segment | *(nothing)* |

**User-visible failure.** `WorkingRail.vue:33` renders an empty label as **"Working…"** with a generic
monogram, and `:47-57` routes the click to
`sidebar.openSession({ sessionId: entity.segmentId, title: labelOf(entity) })`. That segment is the
global brain's (or the voice thread's) hidden row, and the detail route walls both scopes off from a
non-root caller — `apps/local-api/src/routes/sessions/index.ts:278`
`forbiddenScopes: fromGlobalRoot ? [] : ['global', 'voice']` → `get-chat-session-detail.ts:49` throws.
So: a nameless chip appears on the shell rail for **every** turn the user types into Global, plus every
Telegram reply, schedule fire, report delivery and spoken turn — and clicking it opens a pane that
cannot load. The `brain` row ("Claude", ✦) is now unreachable.

**Minimal fix.** Make the rail ask the shared helper instead of reading an absence:

```ts
if (isTurnInGlobalArea(turn)) { /* brain row when origin !== 'web' */ }
else if (turn.primarySessionId != null) { /* session row */ }
else if (turn.scopeKind === 'workspace' && turn.workspaceId != null) { /* workspace row */ }
```

`isTurnInGlobalArea` already exists (`composables/activity/match-turn-to-identity.ts:59-63`) and is
exactly this question. **CONFIRMED + REPRODUCED.**

---

### Verified clean (traced, no finding)

- **The voice/global wall**, server side: `getSessionsOverview` / `countSessionsOverview` drop voice
  unconditionally (`get-sessions-overview.ts:44-47`); the interrupt door restricts scopes; the
  Voice-chat doors carry no `x-mcp` (`routes/root/voice-chat.ts:9-12`).
- **Feed `end()` idempotency** — first outcome wins (`session-activity-feed.ts:153-155`), so the
  `activityHandle.end('failed')` + `finally { activityHandle.end() }` pairs in `run-task-job.ts` and
  `run-report-delivery-tick.ts` record the failure, not a clean end.
- **Terminal-write CAS** (`55a29bfc`): complete/fail guard `status='claimed'`, requeue guards
  `claimed|pending`, and *every* settle home checks the null
  (`settle-completed-task.ts:109-117`, `settle-failed-delegation-attempt.ts`,
  `classify-turn-failure.ts` requeue helpers). No double-settle path found.
- **Heartbeat independence** — `startDelegationLeaseHeartbeat` is a plain `setInterval`, *not* gated
  on the wait gate, so a card parked for 12 minutes does not lapse a 3-minute lease. (This was the
  most dangerous way the lease could have re-opened L1; it was avoided.)
- **Catch-up exactly-once** — marked on `session-started`; a failed mark re-injects (repeat, never
  loss) (`run-global-root-turn-core.ts:262-270`).
- **A3c idempotency is real** — the delivery job id IS the inbound row id
  (`run-report-delivery-tick.ts:368,469`), and *both* user-row writers are find-or-insert
  (`consume-session-event-stream.ts:157`, `handle-session-started.ts:164,209`).
- **D→C wire assumptions hold**: `chat-turn.ts:431-437` still stamps **no** `primarySessionId` on
  workspace turns (the absence D's workspace identity depends on).

---

## 2. Stuck points

Ranked by "can a user hit it and not get out".

| # | Stuck point | How it happens | Bound / recovery today | Evidence |
|---|---|---|---|---|
| 1 | **A scheduled turn parks on an approval card nobody sees** | `fire-schedule.ts:139` runs `bypass-with-behavior-gate`; the floor cards Bash/Write/Edit/NotebookEdit | ~10 min per card (60 s reaper × `requestedAt + 2×5 min`), then denied with the timeout steer. No wall clock on the fire at all | R2-01 · `approvals-recovery-service.ts:28-37` |
| 2 | **A queued interactive turn waits behind N holders** | `runUnderRootTurnLock` / `SessionTargetLocks.acquire`, both unbounded FIFOs; a disconnected client's waiter is not cancelled | each holder is bounded (60 min working time), so the queue drains — worst case N × 60 min; `turn-queued` says "busy", never "how long" | R2-06 · `root-turn-lock.ts:41-57` · `session-target-locks.ts:28-35` |
| 3 | **The root lock held across a long human park** | ask parked 2 h (clock suspended) + 60 min of work | bounded at ~3 h; channel turns for that user queue behind it; global deliveries yield their slot every 5 s and lose nothing | R2-08 · `run-report-delivery-tick.ts:279-291` |
| 4 | **A live delegated run reaped by the lease sweeper after suspend/resume** | timers frozen ⇒ `leaseExpiresAt` in the past on the first sweep | CAS prevents corruption; the user gets a false "interrupted" for work kinds and a duplicate notify turn for message kinds | R2-05 |
| 5 | **A restart-surviving interactive checkpoint waits for the user** | nothing resumes it; no boot pass, no UI state | resumes on the next genuine turn, silently until then | R2-03 |
| 6 | **A call-leg reply lost to a speech collision after the watchdog** | `LineSpeaker.speakLine` throws when a line is in flight; `#speak` swallows it | logged, line dropped, conversation continues | R2-04 |
| 7 | **A wake turn the daemon abandoned answers into a changed room** | daemon watchdog (5 min default) hands the room back; the server turn runs on and later `speak`s | the answer arrives behind whatever the user said next; each server turn is still bounded by the wall clock | `voice-session-driver.ts:272-281` |
| 8 | **A checkpoint handed to a follow-up job that never claims** | boot reap / lease sweep / user Stop on the pending row | never continued, never noted; self-heals on the identity's next checkpoint | R2-09 |
| 9 | **A wall clock that fires before the session id resolves** | fresh conversation + a provider that starts and then hangs | `session-errored` reaches the client; the provider is *not* interrupted and the lock is held until it ends on its own | R2-07 |

**Bounded and correct (re-verified this round, no finding):** the delegated hard cap (pausable, one
lever, settle-after-cancel) · the lease heartbeat's independence from the wait gate · the ask timer +
reaper + turn-end cancel + boot sweep (four nets) · the approvals reaper · the continuation cap (3,
terminal-gated, DB-backed so it survives a restart) · `routeRequest`'s never-reject contract · every
delegation terminal write CAS'd on the claim · the global-delivery slot yield · the daemon's connect
deadline (`run-brain-turn.ts:68,92-96`) and per-turn abort · `speakThroughDaemon`'s 4 s bound ·
`SessionTargetLocks` release idempotency and the `finally` on every stream path.

---

## 3. Modes / models / effort / autoBuildout — binding and inheritance

Rule everywhere: **`input ?? row ?? DEFAULT`**, one resolver per family
(`packages/chat/src/settings/resolve-turn-session-settings.ts:41-49`), `DEFAULT_SESSION_MODE = 'auto'`
(`packages/session/src/session-mode.ts`). Round-1's row set kept so the lead can diff directly.

| Path | mode | model | effort | autoBuildout | Source of truth | Verified by |
|---|---|---|---|---|---|---|
| Global web | input ?? row ?? **auto**; stamped on every routing request unconditionally | input ?? row, fit-clamped | input ?? row | input ?? row → autopilot marker | row + request | `interactive-turn-settings.ts:67-75` · `global-root-turn.ts:182-183,437-439` |
| **Voice — all four legs** (wake, overlay, call, typed panel) | **tier `auto`, forced**; row never read | **`claude-sonnet-5`**, fit-clamped | **`low`** | **never** (`undefined`) | `contracts/chat/voice-tier.ts` only | `interactive-turn-settings.ts:78-104` · `session-turn.ts:106-112` · write skipped at `global-root-turn.ts:357` / `session-turn.ts:303` · PATCH 403 at `update-chat-session-settings.ts:44` |
| Workspace chat | input ?? row ?? auto; stamped always | input ?? row | input ?? row | input ?? row → marker | row + request | `chat-turn.ts:132-138,189,331-333` |
| Spawned / agent DM | same | same | same | same | row + request | `session-turn.ts:107-125,341-349` |
| **Spawned session at BIRTH** | creator row's, or NULL when there is no ambient turn | ✓ | ✓ | ✓ | `x-vynel-turn-session` header | `routes/sessions/index.ts:91-105,339-343` |
| Agent / leaf session at birth | **still NULL** | — | — | — | — | `record-leaf-session.ts` (§7-deferred; behaviour covered by the runner) |
| Delegation enqueue → job row | the parent turn's RESOLVED mode (all 3 streams + the delegated composer) | tool arg else NULL | tool arg else NULL | — | `delegation_jobs` | `delegation-mode-header.ts` + the three `wrapAppRequestWithMode` sites |
| **Delegated task / note runner** | job ?? target row ?? **auto** | job ?? `agent.model` ?? target row, **fit-clamped** | job ?? target row | target row | `resolve-background-turn-settings.ts:57-101` | `run-task-job.ts:207-214` |
| **Agent-run job** | same one home | same | job effort now carried | target row | same | `run-agent-run-job.ts:207` · `enqueue-agent-run.ts:57-60,106` |
| **Report / update / direct / note delivery** | requester row ?? auto (workspace) · global row ?? auto (global) | fit-clamped in both branches | ✓ | ✓ | requester row | `run-report-delivery-tick.ts:397-405` · `run-global-root-turn.ts:266-283` |
| **Channels (Telegram/Discord/Zoom)** | **global row ?? auto** (D1) | global row, fit-clamped | global row | global row | global head segment | `run-global-root-turn.ts:262-283` |
| **Schedule fire** | ⛔ **hardcoded `bypass-with-behavior-gate`** | none (engine default) | none | ⛔ never | — | `fire-schedule.ts:139` — **R2-01** |
| Leaf (Mode-B) | hardcoded `bypass-with-behavior-gate` (by design, §7) | model only | — | — | — | `delegate-to-leaf-session.ts` |
| Swap segment | copy-forward (four columns + status trio + scope + `lastContextWindow`) | ✓ | ✓ | ✓ | predecessor | `record-swap-segment-session.ts` · `handle-session-started.ts` |
| Continuation (interactive) | the checkpointing turn's closure values | ✓ | ✓ | ✓ | pinned (settled) | `run-turn-with-continuations.ts` |
| Checkpoint follow-up job | copied from the parent job on all three kinds | ✓ | ✓ | — (`origin` deferred, G-2) | `enqueue-checkpoint-continuation.ts:151-163` |

**Locked-semantics check.**

- *auto default everywhere* — ✅ except the schedule fire (R2-01). `bypass-with-behavior-gate` is now
  reached by exactly two paths; one of the two is a bug.
- *voice tier forced on every leg* — ✅, and enforced **server-side** on both doors, so a stale daemon
  build cannot reintroduce an old pin.
- *children birth-stamped* — ✅ for spawned sessions; leaf rows still NULL (recorded, covered by A5).
- *`tool arg ?? target row ?? default`* — ✅, one home, three runners.
- *autopilot marker* — ✅ on global / workspace / spawned-DM / channels / delegated; ⛔ schedule fires.
- **One coupling worth naming:** a voice turn resolves `autoBuildout: undefined`
  (`interactive-turn-settings.ts:102`) — correct per D2 — but a *channel* turn reads the GLOBAL row's
  value, so flipping Auto-buildout on the Global composer silently changes how Telegram turns behave,
  with no indication on that surface. Product call, not a defect.

---

## 4. Missed improvements

1. **`use-working-rail.ts` is the proof that "identity by absence" was not fully retired.** The arc
   built `matchTurnToIdentity` and converted five readers; three private predicates survive
   (`activity-store.ts:56-58` and `:66-68` — deliberate and documented; `use-workspace-status.ts:80`
   and `use-working-rail.ts:128,139` — not). A lint-shaped guard ("no direct `.scopeKind` /
   `.primarySessionId` comparison outside `match-turn-to-identity.ts`") would have caught R2-11 at
   write time. Highest-leverage follow-up on the web side.
2. **`GET /sessions/:id/children` has zero consumers.** Route, contract, SDK method and
   `listSessionChildren` all shipped (F3); nothing in `apps/local-web/src` calls `sessions.children`,
   and the nodes screen still has two levels. Same shape as the `/activity/running` seed D5 removed.
3. **The children read caps silently at 50 jobs / 500 chain rows.** `listSessionChildren` passes no
   `limit`, so `listDelegationJobsForParentSessions` takes `DEFAULT_LIST_LIMIT = 50`
   (`delegation-jobs.ts:45,623`); the chain walk rides `listAllChatSessionsForUser`'s 500-row cap. The
   project level's scoped overview likewise takes the 50 default with no "showing N of M".
4. **No observability on the new bounds.** No diagnostics read of held lock keys (`busyKeys()` exists
   and only the pool uses it), no counters for wall-clock expiries, cap fires, lease sweeps or
   checkpoint drops. Each is a `warn` in a log nobody reads in a desktop app. A small
   `GET /diagnostics/session-bounds` would make Kafi's live smokes checkable rather than anecdotal.
5. **Two homes for the chain walk.** `list-session-children.ts:166-187` reproduces
   `fold-session-chains.ts:33-52` (same repo call, same first-write-wins `childByParentId`). F flagged
   it; nobody owns the extraction. `resolveChainSegments(rows, sessionId)` is a two-file move.
6. **`ORPHAN_REQUEUE_JOB_KINDS` deliberately never bumps `attemptCount`**
   (`delegation-jobs-recovery.ts:24-27` explains why — correct for a crash loop). The cost is that a
   *poison* message row requeues forever at 60 s with no circuit breaker. An attempt ceiling that
   fails **visibly** would be better than one that destroys the body.
7. **`run-report-delivery-tick.ts` (577) and `run-task-job.ts` (415) still exceed the ~300-line cap**
   after A6's split. Recorded in §7; restating because the delivery tick is now the densest branch
   point in the system (5 kinds × 2 requester shapes × cap/stop/throw).
8. **The nodes screen shows a two-valued progress bar under a 25/50/75/DONE axis**
   (`constellation-scene.ts:285,367,382`; `NodesRace.vue:25`
   `left: node.status === 'building' ? '50%' : '0%'`). Everything else there is honest; this invents a
   number and dresses it as a measurement. Derive it from `tasksDone/tasksTotal` (already on
   `SceneNode.detail`) or drop the axis labels.
9. **`SceneNode.detail` is populated and rendered nowhere** (`constellation-scene.ts:31-40`; producers
   at `use-fleet-nodes.ts:48-55`, `use-project-nodes.ts:112-116`). Deferred deliberately; the cost is
   live facts carried every frame and shown to no one.
10. **Tests do not cover the two seams that actually broke this round.** No test that a global turn's
    feed frame produces no session-kind rail entity; none that the overlay de-dup predicate is
    turn-scoped. Both are pure-function assertions (`buildRailEntities`; a `view.state` predicate) —
    the cheapest possible regression pins.

---

## 5. Monitoring binding + node display

### (a) The Nodes view

**Bound to real truth: yes, with two exceptions.** `resolveNodeStatus` (`node-status.ts:25-27`) is a
palette rename over the real ladders; the fleet level reads `useWorkspaceStatuses`
(`use-fleet-nodes.ts:33`), the project level reads a **scoped** overview
(`use-project-nodes.ts:49-53` — `scope: 'workspace', workspaceId`), which closes N1, plus
`chat.getContinuing`. The exceptions: the invented progress fraction (§4 item 8) and the
client-minted `name: "The build" / initials: "BD"` (`use-project-nodes.ts:106-107`).

**Enlargeable now: substantially — but a third level is still a code change.**

- ✅ `SceneNodeRef` is genuinely one vocabulary: union at `constellation-node-ref.ts:19-41`, minted
  only through `sceneNodeId()` (six call sites), parsed at exactly one site (`NodesView.vue:168`),
  separator-safe (`:56` takes the first colon only). N4's "prefixed strings parsed in three places" is
  closed.
- ✅ A level **stack** replaced the boolean (`NodesView.vue:68`, `node-level.ts:72-79`).
- ✅ Count-aware layouts with asserted thresholds: constellation rings (capacity 12,
  `constellation-layout.ts:147-164`), orbit lanes (cap 8, `:96-107`), rise step
  `min(base, band/(count-1))` (`:110-124`). N3's "nodes leave the stage from the 9th" is closed.
- ✅ Scene slots are id-reconciled once per `setNodes` (`constellation-scene.ts:833-843`), not
  index-keyed per frame.
- ✅ `hasAnswered` wired at the fleet level and gating the counts row
  (`NodesView.vue:93-98,128-138,229` → `NodesFleetBar.vue:88`).

**What still blocks it:**

1. The level registry is a literal in the view (`NodesView.vue:111-114`) and the stack-top reader is
   kind-hard-coded (`:71-74` `top?.ref.kind === "workspace" ? top.ref.id : null`). Level 3 = a new
   composable + an import + a registry key + a parallel `insideSessionId` computed + a second descend
   path (`:81-84`, `:160-162` both assume a workspace).
2. **The data for level 3 exists and is unconsumed** — `GET /sessions/:id/children`
   (`routes/sessions/index.ts:587-617`) and `SessionChild`
   (`packages/contracts/src/chat/session-children.ts`), with **no** caller in `apps/local-web/src`.
   And `SessionChild.status` is a *third* vocabulary (`queued|running|completed|failed`) that
   `resolveNodeStatus` does not accept, while child sessions report `status: null`
   (`list-session-children.ts:117`) and must be joined to the status pipeline.
3. **The project level's `hasAnswered` is asymmetric** — `use-project-nodes.ts:137-141` gates on
   `sessionsQuery` + `continuingQuery` only, **not** on `workspaceStatuses`, which the build dot reads
   at `:103`. So inside a project the build dot paints grey (`?? "not_running"`, `:108`) and counts as
   idle while `/workspaces/statuses` is in flight — the N2 class, one level down. **NEW P3.**
4. Node visuals are count-blind: fixed 26 px radius (`constellation-scene.ts:713`), labels at
   `+rad+21/+37` (`:768,773`), fixed 30 px hit radius with an O(n) scan per mousemove (`:797-805`). At
   4 rings the ring scales are 0.1·ry apart — dots collide before the ring maths runs out.

### (b) The wider live binding

**The pipe is one pipe and the vocabulary is now honest.** `SessionActivityFeed` → `session_turns`
mirror → `LiveChannelHub` (one WS per window) → `activity-store` → `matchTurnToIdentity` →
`deriveSessionStatus`. `scopeKind ∈ {global, workspace, voice}` plus `primarySessionId` on every
`begin` — exactly the acceptance bar.

- ✅ **One helper.** `match-turn-to-identity.ts:31-52`, four identity kinds, used by `activity-store`
  (`:35,45,86`), `use-session-statuses` (`:58,66`), `VoiceChatPanel` (`:60`), `TasksPanel`
  (`:105-112`).
- ✅ **Voice never binds to global.** `use-continuing-conversation.ts:66-69` binds the Global chat
  through `{kind:'primary', primarySessionId: rootSessionId}` and returns **null** rather than falling
  back while the root id is unknown; `{kind:'global'}` (the *area*) is used only for the presence dot
  and the origin copy (`activity-store.ts:35,45`).
- ✅ **Voice has a status** — `getVoiceChatOverviewEntry` behind `GET /root/voice-chat/status`, read
  by `use-voice-chat-status.ts` through the same `liveTurnStartedAtForEntry`; the Voice chat menu row
  wears its own mark; `TasksPanel` deliberately excludes it (`:98-102`).
- ✅ **Overlay Stop is identity-shaped** — three routes, five refusal guards, no absence-claim
  (`DesktopControlOverlayView.vue:130-148`); D's warned-about `primarySessionId === null` test is gone.
- ❌ **`use-working-rail.ts` still infers identity from an absence, and is now wrong** — R2-11.
- ⚠ **`use-workspace-status.ts:80`** keeps a private `scopeKind !== 'workspace' || workspaceId === null`
  predicate instead of the helper. Correct today; same fragility class as R2-11.
- ⚠ **Two global-status derivations still coexist** (`globalStatusView` vs
  `use-workspace-status.globalStatus`) and agree only by precedence — unchanged this round.
- ✅ `/activity/running` removed (D5); the durable `session_turns` mirror remains for facts.
- ⚠ **The whole web layer rests on one wire invariant**: a voice turn must stamp its OWN primary id.
  Stamping the global root's id there would satisfy `{kind:'primary'}` at
  `use-continuing-conversation.ts:69` and re-open V2 instantly. It is asserted at
  `global-root-turn.ts:336-337` and pinned by tests, but the contract marks the field optional
  (`packages/contracts/src/chat/session-activity.ts:46-47`) — nothing types the invariant.

---

## 6. Session continuity everywhere

**Coverage is complete and now enforced.** `continuity-census.test.ts` asserts the 5 ↔ 5 identity
(every production `consumeSessionEventStream` site wrapped by `withBoundaryContinuity`), so what was
hand-verified in round 1 is now a test. Every runner path:

| Runner | Boundary continuity | Auto-continue | Carry / denominator |
|---|---|---|---|
| Global web (`streamGlobalRootTurn` → core) | ✅ `run-global-root-turn-core.ts:325-338` | ✅ `runTurnWithContinuations` | ✅ |
| **Voice** (same core) | ✅ own primary, own lock `${userId}:voice` | ⛔ by decision (`autoContinue: false`) | ✅ |
| Channels / report-delivery (`runGlobalRootTurn` → core) | ✅ | ⛔ for delivery turns | ✅ |
| Workspace chat | ✅ via `runContinuingTurn` (`chat-turn.ts:380-393`) | ✅ when `isContinueActive` | ✅ |
| Spawned / agent DM | ✅ (`session-turn.ts:394-406`) | ✅ | ✅ |
| `delegate-to-{workspace-root,spawned-session,agent-session}` | ✅ | via follow-up job | ✅ |
| Agent-run job | ✅ | via follow-up job | ✅ |
| Schedule fire | n/a (fresh session per fire) | n/a | n/a |

**What the arc fixed.** Durable checkpoints on `primary_sessions` with a three-state slot (none /
pending / handed-over); the depth cap keeps counting across a restart; the follow-up job id is
persisted so its claim reads as a continuation, never a genuine turn; the stray-vs-survivor split is
honest in both homes (`run-turn-with-continuations.ts:91-97`,
`run-report-delivery-tick.ts:500-511`); drops are visible (`dropPendingCheckpoint` writes an
anchor-shaped note row through `chat/records`); the denominator is persisted (`lastContextWindow`),
copied forward on swap, and read by the fit guard, the pressure check, whoami and the overview meter,
so a small-model visitor no longer rewrites the meter.

**Where it can still break, ranked:**

1. **A survivor waits for the user** (R2-03) — the interactive half needs the next genuine turn; no
   boot pass, no UI state. This is the gap between §3 G1's wording and the code.
2. **A handed-over slot whose job dies leaks** (R2-09) — never continued, never noted.
3. **Concurrent global + voice seeded swaps share one cwd.**
   `resolve-global-root-conversation.ts:42` and `:62` both return
   `resolveGlobalRootWorkspacePath()`. Round 1 recorded it unexamined; the arc did not scope it. It is
   now *more* reachable, not less: the lock split means a global boundary swap and a voice boundary
   swap can run simultaneously, each spawning a seeded priming session in the same hidden dir.
   `runSeededSwapSession` is deadline-bounded with a real interrupt and writes no fixed-name shared
   files — but this is the one continuity claim with neither a test nor a trace. **PLAUSIBLE,
   unexamined — a named live smoke.**
4. **Carry tail budgeting** now *skips* an over-long line instead of breaking (G4) — the old early-
   `break` loss is gone.
5. **A mid-turn compaction swap splits one turn across two segments** — chain-walkers cope; unchanged.

**Improvements.** (a) The boot pass, or the visible pending state, from R2-03. (b) A `ChatTurnEvent`
kind for the dropped-checkpoint note so a live client sees it without a refetch (§7 records this as a
follow-up; it is the difference between "Vynel said nothing" and "Vynel said why"). (c) One shared
chain walk (§4 item 5).

---

## 7. Score — **8.5 / 10** (round 1: 7)

| Axis | R1 | R2 | Why |
|---|---|---|---|
| Correctness | 6.5 | **8.5** | All three silent loss/leak classes closed (L1 at the coordinator, G2 at `session-started`, V2 on the wire); the CAS-on-claim follow-up closes the door the lease opened. Remaining: one arc promise unkept (R2-01) and one identity regression (R2-11). |
| Stuck-resistance | 5 | **8.5** | Every human-wait now has a bound and an owner: pausable cap, wall clock ×3 streams, ask timer + reaper + turn-end cancel + boot sweep, lease + heartbeat + sweeper, delivery slot yield. Docked for the unbounded lock queues (R2-06) and the schedule fire's card park (R2-01). |
| Settings integrity | 6.5 | **9** | One resolver per family, one default, voice tier forced server-side, birth-stamped children, fit guard on every pick. Docked only for `fire-schedule.ts:139` and the leaf rows. |
| Observability | 7 | **7.5** | One vocabulary on the wire, one identity helper, voice has a status. But three private predicates survive — one now wrong (R2-11) — and none of the new bounds emit anything a human can check. |
| Continuity | 8 | **9** | Durable, capped, census-tested, visible drops, persisted denominator. Docked for the survivor-resume gap and the untested shared-cwd concurrency. |
| Voice | 5.5 | **8.5** | Tier forced on all four legs server-side, no card, own feed scope, own status door, identity Stop, watchdog, queued line, recoverable-not-failed. Docked for the half-effective E3 de-dup (R2-02) and the call-leg speech collision (R2-04). |
| Tests | 7.5 | **8.5** | The seams the arc named are pinned (lock lifetime, call-leg tier, catch-up, continuity census, identity match, layout arithmetic). The two things that broke this round were both pure functions with no pin. |
| Code health | 8 | **7.5** | Comments still carry their incident dates and are still exceptional — but in a codebase this comment-dense a wrong one is a bug report waiting to be believed (round 1's own observation), and three are now wrong: `use-working-rail.ts:12-15` states a contract the code stopped keeping, §7 claims E3 plays relayed speech, §3 G1 claims a restart "resumes" the continuation. Two files remain over the cap. |
| **Overall** | **7** | **8.5** | |

**Why 8.5 and not 9.** §4's acceptance bar is met on four of five lines. The fifth — *"No unbounded
wait anywhere a turn can park: every approval/ask/lock/turn has a bound and an owner"* — is missed
twice: the schedule fire still parks on an unbounded approval card in the one mode that cards, and the
lock queues themselves have no bound. Alongside that, two shipped fixes are described as more complete
than they are (E3, the restart resume) in ways a reader cannot catch without reading the code — the
same "stale invariant comments are load-bearing here" class round 1 named as a structural observation.

**Why not lower.** The overall stays 8.5 rather than tracking the Code-health dip because every one of
the eleven findings is *local*: nine are ≤ a handful of lines, none needs a schema change, none
requires re-deciding a locked semantic, and the two P1s are both single-branch fixes with an existing
helper or constant already in the tree to fix them with. The architecture the arc landed is right; the
residue is finish.

**Path to +0.5 (→ 9).** Four small, local, testable changes: **R2-01** (one literal + a row read),
**R2-11** (three lines through the existing helper + one pure test), **R2-02** (two call sites),
**R2-04** (single-flight the call conversation's speech). Each ships with a pure-function regression
test; none touches schema.

**Path to +1.5 (→ 10).** The robustness arc's remaining half: a bounded/cancellable
`SessionTargetLocks.acquire` plus queue depth on the `turn-queued` frame; a boot pass (or a visible
state) for a surviving checkpoint; an in-process live-job guard on the lease sweeper; a
`GET /diagnostics/session-bounds` so the bounds are observable; the level-3 nodes consumer for the
children door that already ships; and a lint guard making "identity by absence" a compile-time error
outside `match-turn-to-identity.ts`.

---

## 8. VOICE SESSION review

### The trace, re-verified end to end

**Wake (native).** mic → `VoiceSessionDriver.#handleSegment` (`voice-session-driver.ts:222-248`) →
wake word → `shouldHandOff()` (`main.ts:235`: `jarvisEnabled || overlay.hasClient` — with
`VYNEL_VOICE_JARVIS_WINDOW='1'` by default, **every** wake hands off) → else `#runTurn` →
`armTurnWatchdog(VYNEL_VOICE_TURN_WATCHDOG_MS)` racing `#consumeBrainTurn` (`:259-267`) →
`createBrainClient` POST `/root/turn { voice: true, tier }` (`run-brain-turn.ts:175-190`) with a 10 s
connect deadline and the watchdog's `AbortController` (`:87-96`).

**Server.** `streamGlobalRootTurn` → `resolveVoiceConversationTarget` (scope `'voice'`, own primary,
**same hidden cwd** as global) → `resolveInteractiveTurnSettings` returns the tier, fit-clamped, no row
read → `permissionMode = 'auto'` → **no `ask_user` descriptor** (`:217-227`) → wall clock armed inside
the lock → `activityFeed.begin({ scopeKind: 'voice', primarySessionId, origin: 'voice' })`
(`:334-339`) → `turn-queued { busy | context-patching }` when the voice lock is held (`:401-406`) →
core under `${userId}:voice` → catch-up **skipped** → hidden `'voice'` segments → `autoContinue: false`
→ `withBoundaryContinuity`. No settings write-through (`:357`).

**Reply.** The model calls `speak` → `/voice/speak` → `speakThroughDaemon` (4 s bound) → daemon
`onSpeak` four-party router (`main.ts:154-173`): handed-off ⇒ `overlay.publishSpeak` (native fallback
when the client vanished) · idle + client ⇒ overlay · else the native queue. The daemon returns at the
first `session-completed` (`run-brain-turn.ts:149`).

**Overlay leg.** `use-voice-session.ts:43-56` posts the same tier + `voice: true` from the browser and
plays its own turn's `speak` calls; `use-voice-daemon-link.ts:78-82` plays relayed ones unless
`isPlayingOwnTurn()`.

**Call leg.** `POST /sessions/spawned` (no ambient turn ⇒ NULL settings, by design) → per utterance
`runCallTurn` → `/sessions/:id/turn { voice: true, tier }` → `session-turn.ts` forces the tier, skips
the row write, fit-clamps, takes the session's target lock, arms the wall clock, announces
`origin: 'voice'` with the spawned primary. The reply text is spoken directly by the call's own
`LineSpeaker` (no `speak` round-trip). One watchdog per turn (`call-conversation.ts:213-222`).

**Panel leg.** `VoiceChatPanel.vue` — `voice: true`, constant `VOICE_TURN_SETTINGS`, **no session id on
the composer** (`:212-213`), read-only "Hands-free" chips, poll gated on
`matchTurnToIdentity(turn, {kind:'voice'})`, transcript via `GET /root/voice-chat/transcript`, status
via `GET /root/voice-chat/status`, Stop via `interruptTurn({ sessionId })` and **nothing at all** when
no session is known (`use-chat-turn.ts:312`).

### Where it breaks / sticks / drops / double-speaks / leaks

| # | Symptom | Verdict |
|---|---|---|
| 1 | **Drops**: any relayed `speak` (schedule, delivery, panel) during an overlay conversation | **R2-02 — open.** The predicate is session-lifetime, not turn-lifetime. §7 claims this was fixed. |
| 2 | **Drops**: a call turn's late reply after its watchdog, when a second turn or a direct line is speaking | **R2-04 — open.** `LineSpeaker` throws; `#speak` logs and swallows. |
| 3 | **Double-speak** | **None found.** Daemon: handed-off publishes only (never `driver.speak` unless the client is gone, `main.ts:156-162`); idle-with-client delegates; the native branch is exclusive. Browser: the own-turn player and the relayed player are mutually exclusive by `isPlayingOwnTurn` (over-broad, but never *both*). The call leg's `LineSpeaker` throws rather than interleaving. |
| 4 | **Sticks**: daemon deaf | **Closed.** Watchdog (5 min) hands the room back and speaks "still working"; `streamTurnEvents` has an abort + a 10 s connect deadline; `turn-queued` speaks "One moment" once per turn. |
| 5 | **Sticks**: a spoken turn on a card | **Closed.** `auto` ⇒ the floor stands down (`tool-approval-policy.ts:108`); `ask_user` is not attached on the voice leg. |
| 6 | **Out-of-order**: the abandoned wake turn answers after the user has said something else | Bounded and by design (`voice-session-driver.ts:272-281`), but the second utterance starts a *second* voice turn that queues on `${userId}:voice`: the user hears "One moment", then answer #1, then answer #2. Product look, not a bug. |
| 7 | **Leaks** (identity / userId) | **None found server-side.** Voice is dropped from every agent-visible read (`get-sessions-overview.ts:46`), the detail route walls it (`routes/sessions/index.ts:278`), the interrupt door owner-checks and scope-restricts (`interrupt.ts:64-71`), the Voice-chat doors carry no `x-mcp`, `updateChatSessionSettings` 403s a voice row. The one client-side breach is R2-11's rail chip — which the server then refuses. |
| 8 | **Continuity** | **Applied** — own primary, own lock, `withBoundaryContinuity`, swap segments inherit `scope: 'voice'` (pinned), fit clamp against the head so a swap can never hand speech a window it cannot hold. `autoContinue: false` is right while the daemon leaves at the first completion. |
| 9 | **Recoverable-as-failed** | **Closed** — `mapFrameToBrainEvent` (`run-brain-turn.ts:38-47`) maps `isRecoverable === true` to `retrying` and reports `failed` only if nothing completes after it. |

### Ranked voice improvements

1. **R2-02** — make `isPlayingOwnTurn` turn-scoped (two call sites). Without it the whole E3 arc is
   inert in the shipped default config.
2. **R2-04** — single-flight the call conversation's speech so the watchdog's promise ("the reply is
   still spoken") becomes true.
3. **A spoken "problem" signal.** Voice now has a status *entry*, but all the user hears on a failure
   is `FAILED_TURN_LINE` / `CALL_TURN_FAILED_LINE`. A wall-clock cut
   (`errorCode: 'turn-wall-clock-exceeded'`) arrives as a plain `failed`, so the daemon says "Sorry, I
   ran into a problem" for a 60-minute timeout. One mapped line would help.
4. **Name the voice rail chip** — falls out of R2-11.
5. **Per-call `personaName`/label on the feed** so a live call is distinguishable from a spawned
   session in every live view (`session-turn.ts:447-457` stamps none).

### The three recorded open forks

| Fork | Verdict now |
|---|---|
| **`direct_to_user` answers reach only the global catch-up net** | **Still right, still not first — but the ground moved.** G2 is closed (the net can no longer be consumed by a turn that never ran) and V6's daemon half shipped, so both round-1 blockers are gone. What replaced them is R2-02: a `direct_to_user` delivery's `speak` **is** exactly what gets dropped during an overlay conversation. Fix R2-02, then decide — and the decision is now cheap, because voice has an identity on the wire and a status door to hang it on. |
| **Voice-fired TASKS parent on the global conversation** | **Still correct; the reason changed.** Round 1 kept it because voice had no status. Voice now has one, so that argument is spent — but the replacement is stronger: a voice-fired task's report must land where the user reads *later*, and the spoken thread is by construction ephemeral and excluded from `list_sessions`. Parenting on global keeps the report in the one place both the user and the brain can see. **Leave it.** |
| **Per-call sessions gain the routing toolset** | **The prerequisite is now met — go, with one condition.** Round 1 blocked it on V1 (call leg in `ask`) and W1 (unbounded parks). Both are closed: the call leg runs the forced tier `auto` (no card at all), holds the session's target lock, and is bounded by the interactive wall clock. The condition is **R2-04**: a routing toolset makes call turns longer, which fires the watchdog more often, which makes the speech-collision drop more likely. Land the single-flight fix first, then attach the toolset. |

### One more, for the record

`resolve-global-root-conversation.ts:42` and `:62` return the **same**
`resolveGlobalRootWorkspacePath()` for global and voice. The lock split means those two identities can
now run — and boundary-swap — concurrently in one cwd. Five agents did not examine it in round 1 and
the arc deliberately did not scope it. It is the only continuity claim in the system with neither a
test nor a trace, and it is strictly more reachable after this arc than before it. Recommend it as a
named live smoke: start a long global turn, wake voice mid-swap, confirm both threads land their
segments.

---

## Top 10 ranked

| # | ID | Sev | One line | Where |
|---|---|---|---|---|
| 1 | R2-01 | P1 | Schedule fires still run `bypass-with-behavior-gate` and card the floor — the one D3 surface no slice owned; `startChatTurn:198` forwards the literal unchanged | `packages/schedules/src/firing/fire-schedule.ts:139` |
| 2 | R2-11 | P1 | Working rail: every global/voice turn now rails as a nameless "Working…" chip whose click 404s (identity-by-absence regression from C3) | `apps/local-web/src/composables/activity/use-working-rail.ts:128,150` |
| 3 | R2-02 | P2 | The E3 overlay de-dup drops every relayed `speak` for the whole overlay session, not just its own live turn | `JarvisView.vue:30` · `use-voice-session.ts:76` · `use-voice-daemon-link.ts:79` |
| 4 | R2-04 | P2 | The call-leg watchdog can drop the reply it promises and can start a second turn under a speaking one | `apps/voice/src/call/call-conversation.ts:200-252` · `line-speaker.ts:52-55` |
| 5 | R2-03 | P2 | A restart-surviving checkpoint is not resumed — it waits for the user's next message, invisibly | `run-turn-with-continuations.ts:80-86` |
| 6 | R2-05 | P2 | A laptop suspend lets the lease sweeper reap live runs (false "interrupted", duplicate deliveries) | `delegation-service.ts:133-139` · `delegation-jobs-recovery.ts:37-45` |
| 7 | R2-06 | P2 | Lock queues are still unbounded and uncancellable; the wall clock only bounds the holder | `session-target-locks.ts:28-35` · `root-turn-lock.ts:41-57` |
| 8 | R2-07 | P3 | The wall clock cannot interrupt a turn whose session id it does not know yet | `turn-wall-clock.ts:125` |
| 9 | R2-09 | P3 | A checkpoint handed to a follow-up job that never claims leaks its slot with no note | `pending-checkpoints.ts:51-60` |
| 10 | R2-10 | P3 | `interruptTurn` answers `interrupted: true` without checking anything was interrupted | `routes/root/interrupt.ts:72-73` |

Plus two P3s worth folding while nearby: the project level's `hasAnswered` omits `workspaceStatuses`
(`use-project-nodes.ts:137-141`), and the nodes screen's two-valued progress under a 25/50/75/DONE
axis (`constellation-scene.ts:285,367,382`).

---

## Score

**8.5 / 10**, up from round 1's 7. The two structural classes that defined the 7 — the delegation lock
released under a live turn, and unbounded human-waits on card-less surfaces — are genuinely closed, at
the right layer, with tests. What holds it below 9: one unattended surface nobody owned was left on
the retired carding default (R2-01); one identity regression escaped both reviewer passes because a
reader outside the shared helper kept inferring identity from an absence (R2-11); two shipped fixes
are documented as more complete than they are (E3, the restart resume); and the lock queues — the
last unbounded wait — were never scheduled. Every one of those is small, local, and testable, which
is why the architecture score stays high even where the finish does not.
