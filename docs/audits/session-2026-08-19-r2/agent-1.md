# Session system audit — round 2, agent 1

Worktree `feature/session-audit` @ `71dbe151` (main + the merged session-hardening arc).
Entry point: interactive workspace + spawned streams → `startChatTurn` → `runTurnWithContinuations`
→ `withBoundaryContinuity` → `consumeSessionEventStream` → SSE + wall clock → the client. Then
widened to delegation, deliveries, channels, schedules, voice and the monitoring layer.

**Method note.** The arc shipped a green gate (108/108 typecheck · 5/5 parity · 5 791 tests). So the
yield here is deliberately concentrated in what a green gate structurally cannot see: optional
fields silently dropped, coupled folds where only one half landed, absence-as-signal contracts,
doc/comment claims that assert rather than test, and duplicated derivations that agree today.
Every round-1 P1 marked CLOSED below cites the **code** that closes it, never the §7 line that
claims it.

**Score: 7.5 / 10** (round 1: 7 / 10). Rationale in §7. The server core moved a long way (7 of 9
round-1 P1s closed at the code level, a real bounds/lease/continuity machine); the score is held
down because the arc's own acceptance bar ("no unbounded wait anywhere a turn can park") is missed
on two shipped production paths, and because it changed the meaning of a universal wire field and a
default-config voice path without sweeping their readers.

---

## 1. Bugs — all scopes

### NEW · P1

**B1 · Channel-originated global turns have NO wall clock and NO hard cap — the one
lock-holding path the arc left unbounded.**
*Scope:* global · channels · (transitively) voice, deliveries, every queued global job.
*Where:* `apps/local-api/src/sessions/run-global-root-turn.ts:243-522` (no `startTurnWallClock`
anywhere in the file) · `apps/local-api/src/services/channels-service.ts:89-102`
(`runRootTurn: (turnDb, input) => runGlobalRootTurn(...)` — no timeout, no AbortSignal, no
`routeRequest` wrapper) · `packages/channels/src/inbound/route-as-chat-turn.ts:93`
(`await deps.runRootTurn(db, {...})` — a bare await) · lock at
`packages/session/src/runtime/run-global-root-turn-core.ts:96`
(`runUnderRootTurnLock(turnLockKey, ...)`).
*Evidence:* the arc's D5 wall clock (`packages/session/src/runtime/turn-wall-clock.ts`) is
constructed in exactly three places — `streams/chat-turn.ts:402`, `streams/global-root-turn.ts:373`,
`streams/session-turn.ts:419`. All three are SSE streams. The background sibling
`runGlobalRootTurn` — which serves **every Telegram/Discord/Zoom turn** and every global report
delivery — constructs none. Deliveries are rescued by `routeRequest`'s `hardCapMs`
(`run-report-delivery-tick.ts:348-381`, `onHardCap: cancelLever.interrupt`); **channel turns are
not wrapped in `routeRequest` at all.**
*Failure scenario:* a Telegram message arrives; the SDK subprocess wedges (network stall, a hung
MCP tool, the provider never yielding a terminal event). `runUnderRootTurnLock(userId)` is held for
the process lifetime. Every subsequent channel message queues behind it; every global report
delivery yields its pool slot every 5 s forever (`run-report-delivery-tick.ts:279-291`); the user's
own web global turn parks inside the core with a `turn-queued` sentinel and a wall clock that never
arms (it arms inside `resolveTarget`, which runs *after* the lock — `global-root-turn.ts:417-422`).
Recovery: restart. This is precisely round-1 **G1**, closed on the interactive half and left open on
the background half.
*Amplifier:* a channel turn is also the one background global path that **auto-continues**.
`run-global-root-turn.ts:475` sets `autoContinue: false` only when `inboundAttribution` is present
(i.e. deliveries); a channel turn leaves it undefined, so `runTurnWithContinuations` defaults it on
and a checkpointing model runs up to **four** provider turns inside one unbounded lock hold.
*Minimal fix:* wrap the channel `runRootTurn` in `routeRequest` (it already gives never-reject +
pausable hard cap + `onHardCap`), or arm `startTurnWallClock` inside `runGlobalRootTurn`'s
`resolveTarget` exactly as the SSE sibling does — the helper is already generic and needs only a
`waitGate` (the runner builds the park/resolve edges at `:538-553`).
*CONFIRMED* — traced hop by hop: `channels-service.ts:89` → `route-as-chat-turn.ts:93` →
`run-global-root-turn.ts:427` → `run-global-root-turn-core.ts:96`; grep for `startTurnWallClock`
returns three call sites, none of them this path.

**B2 · Schedule fires still hardcode `bypass-with-behavior-gate`, contradicting D3 — and that path
has no bound either.**
*Scope:* schedules (workspace).
*Where:* `packages/schedules/src/firing/fire-schedule.ts:139`
```ts
permissionMode: 'bypass-with-behavior-gate', // D10
```
*Evidence:* §2 of the arc note states "Delivery / update / direct / note turns **and schedule
fires** resolve the requester row's mode `?? DEFAULT` (D3) — no more hardcoded NULL→unattended."
Deliveries did land (`resolve-background-turn-settings.ts`, wired at
`run-report-delivery-tick.ts:397`); schedules did not — `packages/schedules` was in no slice's
ownership list (§3), so the assumption silently did not ship. `bypass-with-behavior-gate` still
cards the static floor (`packages/providers/src/claude/approvals/tool-approval-policy.ts`,
`decideCanUseTool` → `isAlwaysCardTool ? 'card' : 'allow'`), i.e. Bash/Write/Edit/NotebookEdit.
*Failure scenario:* a user on the (new) `auto` default sets a nightly schedule that writes a file.
The turn cards on `Write` with nobody watching. The card is an unbounded `await` reaped only by the
approvals reaper (`recover-stale-pending-approvals` at `requestedAt + 2×5 min`), and the schedule
fire has no wall clock, no `routeRequest`, and no target lock — so the turn sits ~10 minutes and
then proceeds denied. Under D3's intent it should have run `auto` and never carded.
*Minimal fix:* resolve `resolveBackgroundTurnSettings(db, { headSdkSessionId: <the workspace
primary head>, job: { permissionMode: null, model: null, thinkingEffort: null } })` — the helper
already exists and already does `job ?? target row ?? DEFAULT` + the fit clamp.
*CONFIRMED* — read the file; the literal is unchanged since before the arc (`git log -1 --format=%h
-- packages/schedules/src/firing/fire-schedule.ts` predates the arc commits).

**B14 · The working rail was never updated for the identity-carrying wire — the documented brain
chip is dead, and every channel/schedule/voice background turn rails as a nameless "Working…" chip
that opens the hidden global-brain (or the SPOKEN) segment in the sidebar.**
*Scope:* global · voice · channels · schedules · monitoring.
*Where:* `apps/local-web/src/composables/activity/use-working-rail.ts:127-155`
```ts
for (const turn of serverTurns) {
  if (turn.primarySessionId != null) {            // now TRUE for every global + voice turn
    upsert({ kind: "session", key: `session:${turn.primarySessionId}`,
             label: turn.personaName ?? "", segmentId: turn.sessionId ?? null, … })
  } else if (turn.scopeKind === "workspace" && turn.workspaceId != null) { … }
  else if (turn.origin !== "web") { upsert({ kind: "brain", label: "Claude", … }) }
}
```
*Evidence:* the arc made `primarySessionId` unconditional on exactly the producers this file's own
header names — `apps/local-api/src/sessions/run-global-root-turn.ts:410`
(`primarySessionId: conversationTarget.primarySessionId`, and
`resolve-global-root-conversation.ts:38-44` never returns null) and
`apps/local-api/src/streams/global-root-turn.ts:336-338` (same, plus `scopeKind: 'voice'`). So the
first branch swallows them and the third — documented at `use-working-rail.ts:12-15` as *"the BRAIN
rails for its non-web background turns (a Telegram reply, a schedule fire)"* — is unreachable for
those turns. `personaName` is unset on a plain channel/voice turn, so `labelOf` falls through to
`"Working…"` (`components/shell/WorkingRail.vue`, the `entity.label === "" ? "Working…"` branch),
and the click resolves to `sidebar.openSession({ sessionId: entity.segmentId })` instead of
`router.push({ name: 'chat' })`.
*Failure scenario:* (a) a Telegram reply that used to show the ✦ Claude chip routing to the global
chat now shows an anonymous "Working…" chip that opens the *hidden* global-brain segment in the
delegated-work sidebar. (b) Sharper: a **wake-word voice turn** rails the same way, and the click
opens the spoken thread's transcript — `LiveSessionPane.vue` only uses the overview to pick a title
and decide `chattable` (voice is filtered out, so it is view-only), but the transcript itself comes
from `useSessionDetail` → `root.getSession`, which is owner-gated and **scope-agnostic** by design
(`SessionThreadView.vue:25`). So the private spoken conversation becomes readable from the shell
rail. Not the round-1 V2 sticky mis-binding, but the same wall, reopened by a reader nobody updated.
*Why the suite misses it:* `use-working-rail.test.ts:52` asserts the brain chip from
`{ scopeKind: "global", origin: "telegram" }` with **no `primarySessionId`** — a frame no producer
can emit any more. The test passes and defends the pre-arc wire. This file sits inside slice D's
declared ownership (`composables/activity/**`), beside the `match-turn-to-identity.ts` D added.
*Minimal fix:* branch on identity, not on the presence of a field — `matchTurnToIdentity(turn,
{kind:'voice'})` → skip or a dedicated voice chip; `turn.scopeKind === 'global' && turn.origin !==
'web'` → the brain chip; only a turn whose primary is genuinely a *spawned* session gets the session
chip. And re-fixture the test to a frame a producer can emit.
*CONFIRMED* — traced producer → contract → `buildRailEntities` → `WorkingRail.openEntity` →
`LiveSessionPane` → `SessionThreadView` → `useSessionDetail`.

**B15 (P2, listed here because it is the same regression class) · `TasksPanel` binds a live session
off the `global` FAMILY, by object insertion order — the one thing the identity helper says must
never happen.**
*Where:* `apps/local-web/src/components/tasks/TasksPanel.vue:103-117`
```ts
const workingTurns = computed(() => Object.values(activity.serverTurns).filter((turn) =>
  matchTurnToIdentity(turn, scopeWorkspaceId.value === null
    ? { kind: "global" } : { kind: "workspace", workspaceId: scopeWorkspaceId.value })))
const liveSessionId = computed(() => workingTurns.value[0]?.sessionId ?? null)
```
`match-turn-to-identity.ts` states the rule verbatim: *"`global` is a FAMILY, not a thread … must
NEVER be used to bind a view to a session — that is what let a spawned run be mistaken for the
assistant's own thread."* `liveSessionId` is exactly that binding, and `Object.values` is insertion
order, so with the root turn and a delegated run live together `useSessionTodos(liveSessionId)`
shows whichever announced first. Second half: the workspace branch now *narrows* against its own
comment (`:99` "EVERY running turn in this scope") — `{kind:'workspace'}` requires
`primarySessionId === null`, so every spawned/agent turn in the room is excluded from the count and
from `abortLiveSession`. *CONFIRMED.*

### NEW · P2

**B3 · A queued interactive turn's wait is unbounded, and the arc made the worst case 6× longer.**
*Scope:* workspace · spawned session.
*Where:* `packages/session/src/delegation/session-target-locks.ts:28-35` (`acquire` returns a
promise that only settles when the holder releases — no timeout, no cancel) ·
`apps/local-api/src/streams/chat-turn.ts:550` (`await locks.acquire(workspaceId)`) ·
`apps/local-api/src/streams/session-turn.ts:281` (`await locks.acquire(spawned.id)`) · the wall
clock is armed only *after* the acquire (`chat-turn.ts:402` inside `runTurn`, called at `:552`).
*Evidence:* before the arc, `routeRequest` gave up at 600 s and the tick released the target key
(round-1 L1 — the bug). The correct L1 fix makes the delegated run hold its key for the **whole
run**, bounded by `VYNEL_DELEGATED_TURN_MAX_MS` = 3 600 000 ms
(`apps/local-api/src/env.ts:72`). So a user turn queued behind a delegated task now waits up to
**60 minutes** where it previously waited ≤ 10.
*Failure scenario:* the user types into a workspace whose delegated task just started a long run.
The composer shows `turn-queued { reason: 'busy' }` and nothing else for up to an hour. If the user
closes the tab, `session-turn.ts:506-517` documents that the wait is deliberately not cancelled —
so an hour later the message is delivered and a full turn runs against a dead stream.
*Minimal fix:* the honest one is a bounded `acquire(key, { timeoutMs })` that emits a
`session-errored { errorCode: 'queue-wait-exceeded' }` (the wall clock's shape), plus cancelling
the waiter on client abort for the *fresh-message* case. Cheap mitigation: emit a periodic
`turn-queued` heartbeat so the composer can show elapsed queue time.
*CONFIRMED* — the acquire is a bare `new Promise((resolve) => waiters.push(resolve))`; the wall
clock's own header (`turn-wall-clock.ts:11-13`) states "queue time is the holder's budget, not this
turn's", i.e. this is by design and the design has no ceiling on the queue side.

**B4 · A handed-over checkpoint slot leaks permanently when its follow-up job is settled by
anything other than its own claim.**
*Scope:* workspace · spawned · agent (delegated rail).
*Where:* `packages/session/src/continuity/pending-checkpoints.ts:157-163` (`markContinuationJob`
writes `pendingCheckpointJobId`) · `:51-60` (`pendingOf` returns null whenever
`pendingCheckpointJobId !== null`) · `:166-179` (`takeContinuationJob` — the ONLY writer that
clears the job id) · settle paths that never call it:
`apps/local-api/src/services/delegation-orphan-settlement.ts:38` (`failOrphanedClaimedDelegations`
— boot + lease sweep), `packages/session/src/delegation/run-task-job.ts:374`
(`settleFailedDelegationAttempt` with `neverRequeue: true` on the cap branch),
`packages/orchestration/src/repositories/delegation-jobs.ts:382` (`failPendingDelegationJob` — the
user-stop path on a still-pending row).
*Evidence:* the three-state slot is documented at `pending-checkpoints.ts:15-24`. State
"handed over" is exited **only** by `takeContinuationJob(db, jobId)`, called only from
`beginDelegatedTurn` (`enqueue-checkpoint-continuation.ts:74`) — i.e. only when that exact job is
claimed and run.
*Failure scenario:* a delegated task checkpoints; the follow-up job is enqueued and the slot is
handed to it. Before it is claimed, the user presses Stop (`failPendingDelegationJob`) or the app
restarts and the boot pass fails it as a work orphan. The follow-up never claims. The identity's
`pending_checkpoint_next_step` stays set with a dead `job_id` forever. Consequences, all silent:
`peekPendingCheckpoint` → null, so `beginGenuineTurn` reports no survivor and
`dropPendingCheckpoint`'s visible note (the whole point of the drop machinery) never fires;
`build-continuity-context.ts:133` never quotes the step; the row carries stale columns until the
next `markPendingCheckpoint` overwrites them.
*Minimal fix:* clear the hand-over when the follow-up settles without claiming — one call to
`dropPendingCheckpoint`(reason `left-behind`) from `settleOrphanedDelegationClaims` and from the
stop path, keyed by `findPrimarySessionByPendingCheckpointJobId(db, jobId)` (the reader already
exists).
*CONFIRMED* — traced every writer of `pendingCheckpointJobId` (`grep -rn markContinuationJob\|
takeContinuationJob\|clearPendingCheckpoint`); no settle path touches it.

**B5 · A live-CALL voice turn announces `scopeKind: 'global'`, so no voice reader sees it.**
*Scope:* voice (call leg) · monitoring.
*Where:* `apps/local-api/src/streams/session-turn.ts:447-457`
```ts
const activity = c.var.activityFeed.begin({
  userId,
  ...(spawned.scope === 'agent' && spawned.workspaceId !== null
    ? { scopeKind: 'workspace' as const, workspaceId: spawned.workspaceId }
    : { scopeKind: 'global' as const }),
  sessionId: resumeSessionId,
  origin: isVoiceTurn ? 'voice' : 'web',
  primarySessionId: spawned.id,
})
```
*Evidence:* `matchTurnToIdentity({ kind: 'voice' })` is exactly `turn.scopeKind === "voice"`
(`apps/local-web/src/composables/activity/match-turn-to-identity.ts`), and B4 of the arc made the
Voice panel's poll predicate `scopeKind === 'voice'` **with no `origin` fallback, deliberately**
(§6, B's ask 2). A call-leg turn therefore matches `{kind:'global'}` (the family, so the shell dot
lights) and `{kind:'primary', primarySessionId: <call session>}`, but never `{kind:'voice'}`.
*Failure scenario:* during a live call the Voice surface shows nothing live; the call turn is
attributed to the Global area instead. Not a wall breach (the call session is genuinely a spawned
session, not the voice chain), but it means "voice has a status" is only true for the wake/overlay
/panel legs, not the call leg — the leg the arc worked hardest on.
*Minimal fix:* decide the product answer first (is a call a voice-area turn?). If yes, pass
`scopeKind: 'voice'` when `isVoiceTurn`; the feed enum already admits it (Wave 0 widened
`SessionTurnActivity.scopeKind`).
*CONFIRMED* by reading both ends.

**B6 · `POST /root/turn/interrupt` always answers `{ interrupted: true }` for a named session, even
when nothing was interrupted.**
*Scope:* global · voice.
*Where:* `apps/local-api/src/routes/root/interrupt.ts:72-73` vs `:78`
```ts
await interruptChatSession(DEFAULT_PROVIDER_ID, namedSessionId)
return c.json({ interrupted: true })
```
`interruptChatSession` is `Promise<void>` and its own doc says "No-op if the session is not active"
(`packages/chat/src/.../interrupt-chat-session.ts`). The no-id branch at `:76-80` is honest
(`interrupted: false` when there is no head) — the named branch is not.
*Failure scenario:* the UI's Stop on a voice/global thread whose SDK session already ended (or
mid-swap moved to a new segment id the client does not know) reports success; the user believes the
work stopped. Cosmetic today because the feed's `turn-ended` corrects it, but it is the only lie on
this door.
*Minimal fix:* have the provider's `interruptChatSession` return a boolean and thread it through.
*CONFIRMED.*

### NEW · P3

**B7 · A wall-clock cut is reported to the user as "the turn was stopped".**
`packages/session/src/runtime/turn-wall-clock.ts:138` interrupts the session; the provider yields
`session-interrupted`; `run-turn-with-continuations.ts:109` maps `'interrupted'` →
`drop(checkpoint, 'turn-stopped')`; `drop-pending-checkpoint.ts:44` renders "the turn was stopped".
The user did not stop it — the 60-minute limit did. One extra reason value (`'turn-timed-out'`)
fixes it. *CONFIRMED.*

**B8 · The wall clock is armed before `activityFeed.begin`, so a throw from `begin` leaks a live
timer.** `chat-turn.ts:402` (clock) then `:431` (begin) then `:438` (`try`); same shape at
`session-turn.ts:419` / `:447` / `:458`. The zombie-turn doctrine comment at `chat-turn.ts:428-430`
explicitly requires nothing throwable between `begin` and the `finally` — the clock sits on the
wrong side of that line. If `begin` throws, `wallClock.clear()` is never reached and 60 minutes
later `failTurnOnWallClock` writes a failure row + interrupts a session for a turn that never ran.
*PLAUSIBLE* (`begin` is pure map/publish work today, so unreachable in practice).

**B9 · `runTaskJob`'s terminal writers discard the CAS result.**
`run-task-job.ts:348, 370, 389, 408` all call `failDelegationJob(...)` and ignore the returned
`DelegationJob | null`. The CAS itself is correct
(`delegation-jobs.ts:319-339` — `WHERE status = 'claimed'`), so no state is corrupted; but when the
lease sweeper settled the row first, the log still says "delegation job stopped by the user" /
"stopped at terminal time" for a row that is `failed: lease expired`. The delivery tick has the same
shape (`run-report-delivery-tick.ts:517, 525, 538, 543, 562, 570`). §7 claims "the settle homes and
the requeue helper stand down"; the *repository* stands down, the callers do not observe it.
*CONFIRMED.*

**B11 · `ApprovalWaitGate.onParkedChange` is a silent single-subscriber setter.**
`packages/orchestration/src/routing/approval-wait-gate.ts:34-36` — `this.listener = listener`
overwrites without warning, and `startPausableTimeout` is the only subscriber shape
(`pausable-timeout.ts:41`). Today no gate has two: every composition site creates one gate and one
timeout (`route-request.ts:101` per job; `turn-wall-clock.ts:48` per stream). But the type invites a
second — a delivery that ever wanted both a cap and a wall clock on one gate would silently lose the
first one's suspend/resume with no error. One-line fix: push to an array, or throw on a second
subscribe. *CONFIRMED latent* (traced all four gate-creating sites).

**B12 · The interactive wall clock unsticks the USER, not necessarily the LOCK.**
`turn-wall-clock.ts:127-141` persists the failure row and writes the SSE frame (so the composer is
freed and the thread shows the truth), then calls `interruptChatSession`. The stream's `finally` —
which releases the root/target lock — only runs when the provider's generator ends. If the provider
is wedged in the way the clock exists to catch, the interrupt is a no-op
(`interrupt-chat-session.ts`: "No-op if the session is not active") and the lock is still held. So
"every lock has a bound" is true of *budgets* and not yet of *holders*. A hard release (release the
lock on expiry, mark the turn abandoned) is the honest completion. *CONFIRMED by construction* —
`chat-turn.ts:553-559` / `session-turn.ts:506-519` / `run-global-root-turn-core.ts:96` all release
through the generator's exit, never from the clock.

**B10 · Stale load-bearing comment: the voice segment's "invisible until a Voice-chat menu ships".**
`packages/session/src/runtime/run-global-root-turn-core.ts:305-306` still reads "every scope view
excludes 'voice', so the spoken chain stays invisible until a Voice-chat menu ships". The arc made
`foldSessionChains` admit voice and shipped the Voice chat mark. Round-1 §4.3 named stale
load-bearing comments as a finding *source* in this codebase; this is a new one. Sibling:
`NodesView.vue:108-109` claims "A third level … is one composable plus one line here" — false, see
§5(a). *CONFIRMED.*

**B16 · A wall-clock cut can render as "interrupted" (i.e. as the user's own Stop), because the
turn fold has no terminal precedence.**
*Where:* `apps/local-web/src/composables/chat/active-turn-view.ts:345-357` — `session-completed` /
`session-interrupted` / `session-errored` each unconditionally overwrite `status`; nothing guards a
terminal. Producer side: `chat-turn.ts:406-423` (and the two siblings) `await
failTurnOnWallClock(...)`, which at `turn-wall-clock.ts:137-141` awaits `interruptChatSession`
**before** the stream writes its synthetic `session-errored` frame. The interrupt makes the provider
yield `session-interrupted` on the same stream on a later tick, so the two frames race.
*Consequence:* the composer can settle on "interrupted" — the wording for a user Stop — for a turn
that hit the limit, with no message, while `persistTurnFailureRow` (`turn-wall-clock.ts:127`) has
already landed so the status ladder reads `problem`. Red light, "stopped" thread. Related to **B7**
(the dropped-checkpoint note has the same misattribution, from the same interrupt). Fold precedence
is *CONFIRMED*; the render-order race is *PLAUSIBLE* (ordering depends on the provider's tick).

**B17 · The shell's global light silently loses `problem` once the Assistant chain falls off the
newest 50.**
`apps/local-web/src/composables/sessions/use-session-statuses.ts:103-108` +
`use-sessions-overview.ts:16-19` — `useSessionStatuses()` with no entries falls back to the shared
`vynel.sessions.overview()` read with **no scope and no limit** (server default 50, sorted
`lastMessageAt` desc), then does `find(entry => entry.scope === 'global')`. Past 50 more-recent
conversations the global entry is not in the page, so `problem` and `completed` are lost (`running`
still arrives via `activity.hasGlobalServerTurn`, `needs_input` via `attention.global`). A fresh
failure bumps `lastMessageAt`, so the red light does not fail immediately — it goes **grey later**,
precisely when a standing problem has stopped being retried. `use-project-nodes.ts:41-47` carries
the arc's own note about this exact class ("curate before the cap") — fixed there, left here.
*CONFIRMED.*

**B18 · The arc's headline regression suite is flaky.**
`packages/session/src/delegation/run-delegation-claim-and-run-tick.hard-cap.test.ts` failed on 2 of
4 runs in this checkout, always the same way: an **unhandled rejection** out of
`run-task-job.ts:408` (`failDelegationJob` inside the outer `catch`) →
`delegation-jobs.ts:336-337` `.returning().all()` throwing on a database the test has already torn
down. It passes reliably when run alone. Root shape: a capped run's settle outlives its caller's
scope, and the terminal write in `runTaskJob`'s catch block is itself unguarded — if it throws, the
error escapes `runTaskJob` entirely (production catches it at
`delegation-service.ts:187`, and the lease sweeper eventually settles the row, so this is
recoverable at runtime). But the suite that pins the arc's most important invariant is not
trustworthy under load. *CONFIRMED by repeated runs* (1 fail / 2 runs of a 4-file batch, 1 fail /
first run of a 2-file batch, green alone and on a repeat of the 4-file batch).

---

## 2. Stuck points

| # | Stuck point | How it happens | Bound / recovery today | Verdict |
|---|---|---|---|---|
| 1 | **Channel turn wedges the `${userId}` root lock** | provider never yields a terminal event; no wall clock on `runGlobalRootTurn` | **none** — process restart | **OPEN (B1)** — round-1 G1 half-closed |
| 2 | Queued interactive turn behind a delegated run | `SessionTargetLocks.acquire` is an uncancellable await; holder now keeps the key for the whole run | holder releases (≤ 60 min via `VYNEL_DELEGATED_TURN_MAX_MS`) | **OPEN, worse than r1 (B3)** |
| 3 | Interactive turn runs away | — | `VYNEL_INTERACTIVE_TURN_MAX_MS` (60 min working time) → `failTurnOnWallClock` → failure row + interrupt → lock releases through the stream's `finally` | **CLOSED** (`turn-wall-clock.ts`, 3 stream call sites) |
| 4 | Delegated run runs away / holds its target key | — | `routeRequest` hard cap → `onHardCap` → cancel lever interrupts the SDK session → coordinator awaits the settle → `capped` → honest failure delivery, `neverRequeue` | **CLOSED** (`route-request.ts:99-156`, `run-task-job.ts:360-380`) |
| 5 | Claimed job orphaned by a crash / wedge | — | claim stamps `leaseExpiresAt`; 30 s heartbeat (`delegation-lease-heartbeat.ts`); 60 s sweeper `settleOrphanedDelegationClaims({onlyExpiredLeases:true})` settles by kind; env refuses `heartbeat*2 > lease` (`env.ts:187-192`) | **CLOSED** |
| 6 | `ask_user` parked forever | — | interactive descriptor `timeoutMs = VYNEL_INTERACTIVE_ASK_MAX_MS` (2 h) + a 60 s orphan reaper (`asks-recovery-service.ts`) + boot sweep (`boot.ts:430`); channels keep the 10 min bound; **not attached on voice at all** (`global-root-turn.ts:217-227`) | **CLOSED** |
| 7 | Approval card parked forever on a card-less surface | — | mostly *dissolved*: `DEFAULT_SESSION_MODE = auto` and `approvalFloorStandsDown('auto') === true`, so the floor no longer cards by default. Residual: an explicit-`ask` user's channel/delivery turn, and **every schedule fire (B2)** | **PARTIAL** |
| 8 | Global delivery burns a pool slot queued on the root lock | — | yields the slot, `nextAttemptAt = +5 s`, no attempt spent (`run-report-delivery-tick.ts:273-291`) | **CLOSED** |
| 9 | Second global/voice turn looks frozen | — | `isRootTurnLockBusy(rootTurnLockKey(...))` → `turn-queued { reason: 'busy' \| 'context-patching' }` (`global-root-turn.ts:401-406`) | **CLOSED** |
| 10 | Restart mid-checkpoint loses the continuation | — | the register is the `primary_sessions` row; `beginGenuineTurn` returns the survivor and leaves it in place; the interactive loop continues it after the turn (`run-turn-with-continuations.ts:80-97`) | **CLOSED** — except B4's handed-over leak |
| 11 | Root lock wedged by a *parked* interactive turn | — | the wall clock **suspends** while parked (`ApprovalWaitGate` + `startPausableTimeout`), so parking does not consume the budget — but every park kind now has its own bound (#6, #7) | **CLOSED by composition** |
| 12 | Voice daemon busy forever | daemon-side | `VYNEL_VOICE_TURN_WATCHDOG_MS` **on the native `#runTurn` path only**, which `VYNEL_VOICE_JARVIS_WINDOW=1` (the default) makes unreachable | **OPEN on the default surface (V-N0)** |
| 13 | Voice overlay turn with no bound and no Stop | `voice-command-session.end()` aborts the read only; no client calls `root.interruptTurn` | none — the turn runs to completion and speaks | **OPEN (V-N2)** |
| 14 | Daemon stuck `handed-off` forever | a proactive `speak` in the wake→connect window publishes `'speaking'`, which nulls `pendingWake`; the connect replays nothing and the connect watchdog does not `endHandoff` because `hasWakeTarget` is still true | daemon restart | **OPEN** (`overlay-channel.ts:219-222`) |
| 15 | Overlay deaf after a hung `/voice/synthesize` | `fetch` with no `AbortSignal.timeout`; `play()` never resolves, so `/voice/session/end` never posts | daemon restart | **OPEN** (`spoken-audio-player.ts:62-67`) |

**Bounded and correct (re-verified in this checkout):** the delegation retry ladder + backoff gate
(`claimNextPendingDelegationJob`'s `dueNow`); the continuation cap (3, terminal-gated, reset per
genuine turn, now durable); `SessionTargetLocks` release is idempotent and every stream release sits
in an unconditional `finally`; `runUnderRootTurnLock` chains on **both** outcomes so a failed turn
cannot wedge the chain (`root-turn-lock.ts:47`); the busy count is kept beside the tail rather than
derived from it; `activityHandle.end` is idempotent (`session-activity-feed.ts:155-157`); the
heartbeat is `unref`ed and stands down when the row is no longer `claimed`.

---

## 3. Modes · models · effort · autoBuildout — binding and inheritance

Rule everywhere: **`input ?? row ?? DEFAULT`**, one resolver per world —
`resolveInteractiveTurnSettings` (`apps/local-api/src/streams/interactive-turn-settings.ts`) for the
three user-facing streams, `resolveBackgroundTurnSettings`
(`packages/session/src/delegation/resolve-background-turn-settings.ts`) for everything unattended.
`DEFAULT_SESSION_MODE = 'auto'` (`packages/session/src/session-mode.ts`).

| Path | mode | model | effort | autoBuildout | Source of truth | Verified by |
|---|---|---|---|---|---|---|
| Global web (keyboard) | `input ?? row ?? auto` | `input ?? row` | `input ?? row` | `input ?? row` | row + request | `global-root-turn.ts:168-182, 430-439` |
| **Voice — every leg** | **`auto` forced** | `VOICE_TIER_MODEL`, **fit-clamped** | `low` forced | **never** (`undefined`) | `contracts/chat/voice-tier.ts`, no row read/write | `interactive-turn-settings.ts:67, 78-104`; write-through gated at `global-root-turn.ts:357` and `session-turn.ts:303` |
| Voice **call leg** (spawned per-call session) | same — `input.voice` gate on `/sessions/:id/turn` | same | same | — | same | `session-turn.ts:106-113` — **round-1 V1 CLOSED** |
| Workspace chat | `input ?? row ?? auto` | `input ?? row` | `input ?? row` | `input ?? row` | row + request | `chat-turn.ts:132-138, 325-333` |
| Spawned / agent DM | same | same | same | same | row (born stamped) | `session-turn.ts:107-113, 341-354` |
| Delegation enqueue → job row | `x-vynel-delegation-mode`, stamped **unconditionally** by all three streams | tool arg else NULL | tool arg | — | `delegation_jobs` | `chat-turn.ts:189` · `global-root-turn.ts:183` · `session-turn.ts:123-125` — **round-1 T1 CLOSED** |
| `delegate-to-{workspace-root,spawned,agent}` | `job ?? target row ?? auto` | `job ?? agent.model ?? row`, **fit-clamped** | `job ?? row` | target row | `resolve-background-turn-settings.ts` | `run-task-job.ts:207-214`; `delegate-to-*.ts:160/178/160` `?? toPermissionMode(DEFAULT_SESSION_MODE)` — **round-1 M1 CLOSED** |
| Agent-run job | same | `job ?? agent.model`, fit-clamped | **now carried** | target row | job row | `enqueue-agent-run.ts:60,106` + `composer-mention-turn.ts:196-222` — **round-1 T3 CLOSED** |
| Report / update / direct / note delivery (**workspace requester**) | `job ?? requester row ?? auto` | fit-clamped | ✓ | ✓ | requester row | `run-report-delivery-tick.ts:397-405, 455-460` |
| Report delivery (**global requester**) | `row ?? auto` | fit-clamped | ✓ | ✓ | global row | `run-global-root-turn.ts:262-283` |
| Channels (Telegram/Discord/Zoom) | `row ?? auto` | fit-clamped | ✓ | ✓ | global row | `run-global-root-turn.ts:266-283` — **D1 honoured** |
| **Schedule fire** | **hardcoded `bypass-with-behavior-gate`** | none | none | **none** | — | `fire-schedule.ts:139` — **GAP (B2)** |
| Leaf ("hand") session | hardcoded `bypass-with-behavior-gate` | model only | — | — | by design, recorded deferred | `orchestration/src/leaf/map-agent-to-leaf-input.ts:34` |
| Swap segment | copy-forward | ✓ | ✓ | ✓ | predecessor | `record-swap-segment-session.ts:115` + `handle-session-started.ts:158` (incl. `lastContextWindow`) |
| Continuation (interactive) | the genuine turn's closure values | ✓ | ✓ | ✓ | the checkpointing turn | `runContinuingTurn` closes over `turnSettings` |
| Checkpoint follow-up job | copied from the parent job (mode/model/effort/requester/chain/origin) | ✓ | ✓ | inherited via target row | job row | `enqueue-checkpoint-continuation.ts:151-175` |
| Birth-stamp: spawned session | creator's **persisted row** | ✓ | ✓ | ✓ | ambient `x-vynel-turn-session` | `routes/sessions/index.ts:90-104, 340-344` — **round-1 T2 mostly CLOSED** |
| Birth-stamp: **leaf / agent** rows | **still NULL** | NULL | NULL | NULL | — | `record-leaf-session.ts:50-66` — **GAP (row hygiene; behaviour correct via the resolver)** |
| Autopilot marker (D8) | — | — | — | appended to the **provider** text only, per message | `instructions/autopilot-marker` | `start-chat-turn.ts:186-189` (workspace/DM/spawned) + `run-global-root-turn-core.ts:189` → `compose-global-root-provider-message` (global/channel) — **the two spread lines §6 flagged as "in nobody's diff" DID land**: `chat-turn.ts:331-333`, `session-turn.ts:347-349`, `global-root-turn.ts:437-439` |

**Gaps ranked:** B2 (schedule fires) → leaf-row NULL hygiene → autoBuildout is inherited by a child
only via the target *row*, so a spawned session created by an autopilot **voice** turn is born NULL
(voice never persists) → nothing else material.

**Locked semantics verified:**
- `auto` everywhere by default ✓ (`session-mode.ts`; every `?? DEFAULT_SESSION_MODE` site).
- Voice tier forced on every leg ✓, and *provably card-free*: `approvalFloorStandsDown('auto')`
  returns true, so `decideCanUseTool` returns `'allow'` before the floor/mutating sets are consulted
  (`tool-approval-policy.ts`). `alwaysRequireApprovalToolNames` cannot resurrect a card under auto.
- Children birth-stamped ✓ for spawned; ✗ for leaf/agent rows (behaviourally masked).
- `tool arg ?? target row ?? default` ✓ (`resolve-background-turn-settings.ts:60-77`).
- Autopilot marker rides the provider input per message ✓ (not the system prompt — the voice-marker
  precedent honoured).
- `updateChatSessionSettings` refuses a voice row (403) ✓, and the one write-through caller
  (`persistTurnSessionSettings`) swallows it — but both voice streams already gate the call, so the
  refusal is belt-and-braces, not the enforcement.

---

## 4. Missed improvements

1. **One bound helper, three of five callers.** `startTurnWallClock` is generic and takes only
   `{maxMs, waitGate, onExpire, logger}`. It is wired into the three SSE streams and *not* into
   `runGlobalRootTurn` (B1) or `fireSchedule` (B2) — the two paths with nobody watching. The
   acceptance bar §4 says "no unbounded wait anywhere a turn can park"; it is met for surfaces a
   human is looking at and missed for the two that most need it.
2. **The queue side of every lock is still unbounded** (B3). The arc bounded *holding*; it did not
   bound *waiting*. A `acquire(key, { timeoutMs, signal })` would close the class and make the
   client-disconnect semantics honest.
3. **Terminal writers return a CAS result nobody reads** (B9). Making `failDelegationJob` /
   `completeDelegationJob` return-checked at the six call sites turns a silent "settled elsewhere"
   into a correct log line and a skipped failure-delivery push.
4. **The hand-over slot has one exit and four entrances to failure** (B4). Either make
   `takeContinuationJob` the *only* way a follow-up job can be settled, or teach every settle path
   to release the slot.
5. **Two homes for the chain walk.** `chainSegmentIdsOf` in
   `packages/session/src/overview/list-session-children.ts` reproduces `foldSessionChains`' walk;
   `resolveSegmentContextWindow` (`continuity/segment-context-window.ts:44-57`) implements a *third*
   backward walk with its own cycle guard and cap. Three walkers over `continuedFromSessionId` that
   agree today. F flagged two of them (§6 F→D); the third is unflagged.
6. **The continuity census is file-level, not call-level** (`continuity-census.test.ts:76-83`). A
   runner that consumes twice and wraps once passes. Cheap tightening: count occurrences.
7. **`markCatchUpSurfacedOnSessionStarted` marks at `session-started`, not at
   `user-message-persisted`.** The reasoning at `run-global-root-turn-core.ts:253-259` is that the
   input is in the SDK session from that instant. That is a claim about SDK internals defended by a
   comment, not a test. `handleSessionStarted` already yields `user-message-persisted` — marking
   there would be provably after the row exists, at no cost.
8. **Observability of the locks.** `busyKeys()` and `isRootTurnLockBusy` exist and are used for
   flow control, but nothing exposes held keys / queue depth / oldest-holder age for diagnosis.
   Round-1 Tier C asked for this; it did not ship.
9. **No test pins the "workspace turns stamp no `primarySessionId`" contract.** D's identity match
   depends on that absence (`match-turn-to-identity.ts`, `workspace` branch), and §6 explicitly
   warns "if workspace turns ever start stamping it, workspace binding silently stops working". The
   guard for that is a comment. A three-line stream test would make it a type-of-error.
10. **A `ChatTurnEvent` kind for the dropped-checkpoint note** (recorded deferred). Today a
    restart-survivor drop is a row a live client only sees on refetch. The machinery is excellent;
    it is invisible in the moment it matters most.

---

## 5. Monitoring binding + node display

### (a) Nodes — bound to real truth; more enlargeable than round 1, less than the file claims

**Bound to truth: yes, and better than round 1.** The project level no longer reads the shared
50-cap unscoped page and filters client-side — `use-project-nodes.ts:50-52` calls
`vynel.sessions.overview({ scope: 'workspace', workspaceId })` and derives its statuses from **its
own** entries (`:77` — "Statuses derive from OUR entries, not the shared read"). Round-1 **N1
CLOSED**. `hasAnswered` is wired at the fleet level (`use-fleet-nodes.ts:77-80,93` →
`NodesView.vue:128 levelHasAnswered`), so fleet dots no longer paint confident grey during the poll
flight — round-1 **N2 CLOSED**.

**Enlargeable now: yes, structurally.** The four blockers round 1 named are gone:
`SceneNodeRef` is a discriminated union minted and parsed in one place (`sceneNodeId({kind, id})`
is used at `use-project-nodes.ts:105` rather than string concatenation at each site); the boolean
`isInsideProject` is replaced by a level stack (`NodesView.vue` reads `level.value.*`, one
composable per level, so a third level is a third composable rather than a sixth `if`);
`SceneNode.detail` carries note / task counts / room for elapsed + child count (rendered nowhere
yet — F resolved the tooltip promise by dropping the promise, not by building the tooltip); and the
data source for a third level exists: `GET /sessions/:id/children` +
`packages/session/src/overview/list-session-children.ts` (spawned sessions + agent runs + tasks by
parent primary, from `session_turns.primarySessionId` + `delegation_jobs.threadId`, with the
appended `listDelegationJobsForParentSessions` read in its correct home).

**But "one composable plus one line" is not true, and the file says it is.** `NodesView.vue:108-109`
promises a third level is one composable + one registry line. It is not:
```ts
const insideWorkspaceId = computed(() => {
  const top = stack.value[stack.value.length - 1];
  return top?.ref.kind === "workspace" ? top.ref.id : null;   // NodesView.vue:70-73
})
```
It reads only the **top** of the stack. Push a `session` level on top of a `workspace` and
`insideWorkspaceId` becomes null — taking `insideWorkspaceName`, `openDrilledProject` and the fleet
bar's Chat button with it. A third level needs this rewritten to scan the stack for the nearest
workspace. Related: `activeNodeLevel` keys by `ref.kind`, so two nested levels of the same kind
(session → child session) would share one composable instance — workable only under a
"levels read the stack top" contract nobody has written down. So: the level stack removed the
*six-computeds* blocker and replaced it with a *smaller, undocumented* one. **CONFIRMED** (read both
files).

**What still blocks more levels / nodes / info:**
1. **The detail bag is carried and unrendered.** Adding "more info" is now one component, but that
   component does not exist and D7 defers the visual to Kafi — so today enlargement means more
   *nodes*, not more *info*.
1b. **The children door is built, tested (9 green) and unwired** — no `useSessionNodes`, no registry
   entry, no web caller of `sessions.children` anywhere in `apps/local-web/src`; the route's own
   comment says "Nothing renders it yet". And the project level's `onPick` discards the ref
   (`NodesView.vue:104-105` — `onPick: () => openDrilledProject()`), so the `session` ref's whole
   purpose is currently unused.
2. **`delegation_jobs` has no index on `parentSessionId`** (flagged by F to A in §6, not added). Fine
   on local SQLite; it is the first thing a third level makes hot.
3. **A third home for the chain walk.** `chainSegmentIdsOf` (`list-session-children.ts`) reproduces
   `foldSessionChains`' walk deliberately, and `resolveSegmentContextWindow`
   (`continuity/segment-context-window.ts:44-57`) is a *third* independent backward walk over
   `continuedFromSessionId`. Three walkers, one relation.
4. **`useMessageEdges` stays a poll** (recorded deferred) — edges are the one part of the scene not
   folded onto the live channel.

### (b) The wider live binding — one vocabulary, one predicate, one residual leak

**Identity is on the wire now.** `SessionTurnActivity` carries `scopeKind ∈ {global, workspace,
voice}` + `primarySessionId` (`session-activity-feed.ts:100-115`), and **one** predicate reads it:
`matchTurnToIdentity` / `isTurnInGlobalArea`
(`apps/local-web/src/composables/activity/match-turn-to-identity.ts`). Consumers verified:
`activity-store.ts:35,45,86`, `use-session-statuses.ts:58,66`,
`use-continuing-conversation.ts:66-69` (now keys on `{kind:'primary', primarySessionId:
rootSessionId}` instead of "a global turn with no id"). Round-1 **V2 CLOSED** at both ends.

The asymmetry is stated out loud in the helper's header and is correct: `global` is a **family**
(presence only, never binding), `voice`/`workspace`/`primary` are identities. One deliberate
non-use remains — `activity-store.ts:51-57` keeps a private workspace predicate *without* the
`primarySessionId === null` clause, documented as "deliberately NOT
`matchTurnToIdentity({kind:'workspace'})`" because that reader wants everything announcing under the
room, not the room's own thread. Legitimate, but it means the "one predicate" claim has one
documented exception.

**Residual leak / drift:**
- **B14 (P1)** — the working rail still branches on `primarySessionId != null`, which the arc made
  universally true for global and voice turns. The documented brain chip is dead and a voice turn
  rails as an anonymous "Working…" chip that opens the spoken transcript. The reader lives inside
  the slice that introduced the new wire and beside the new helper.
- **B15 (P2)** — `TasksPanel` binds `liveSessionId` off `{kind:'global'}` (the FAMILY) by object
  insertion order, which is the exact thing `match-turn-to-identity.ts`'s header forbids.
- **B17 (P2)** — the shell's global light loses `problem` past the 50-row overview cap.
- **B5** — the voice CALL leg announces `scopeKind: 'global'`, so it is invisible to every voice
  reader while being the most user-visible voice state there is.
- **Two more private re-derivations** of `serverTurnForSession` (`SessionThreadView.vue:119-125`,
  `AgentRunPane.vue:28-33`) inline `Object.values(activity.serverTurns).some(t => t.sessionId ===
  id)` while the store already exposes it — harmless (plain segment-id match, no identity
  inference), but the "one predicate" story has more exceptions than the header admits.
- **The absence contract is defended by a comment, not a test** (§4.9): `chat-turn.ts:431-437`
  begins a workspace turn without `primarySessionId`, and `matchTurnToIdentity`'s `workspace` branch
  requires exactly that. Nothing fails if a future change stamps it.
- **Voice status is real.** `foldSessionChains:66-68` admits `tail.scope === 'voice'` (so the chain
  gets `statusFacts` and a FAILED voice turn can light `problem`), while
  `get-sessions-overview.ts:46` drops voice unconditionally from every list read and `:89-93`
  exposes it only through the dedicated `getVoiceChatOverviewEntry` door. Round-1 **V3 CLOSED**, and
  D's deviation from the plan (drop in the overview rather than filter in three consumers) is the
  safer call: `GET /sessions/overview` unscoped *is* `list_sessions`' answer, so a filter in the UI
  consumers would have leaked the spoken thread to every workspace manager.
- **`/activity/running` and `listRunningTurns` are gone** (grep returns nothing) — round-1 hygiene
  item CLOSED.
- **No lock diagnostics** (§4.8): `busyKeys()` / `isRootTurnLockBusy` drive flow control but nothing
  surfaces held keys, queue depth or holder age — the one observability gap that would have made
  B1/B3 self-evident.

---

## 6. Session continuity everywhere

**Coverage is complete and now enforced by construction.** `continuity-census.test.ts` asserts
5 consumers ↔ 5 wrappers *and* pins the roster, so a sixth runner fails the suite before it lands.
The five: `delegate-to-agent-session.ts`, `delegate-to-spawned-session.ts`,
`delegate-to-workspace-root.ts`, `run-global-root-turn-core.ts`, `start-chat-turn.ts`. Every
interactive stream reaches the last two; every delegated runner reaches the first three.

**What the arc genuinely fixed:**
- **Durable checkpoints.** The register is the identity's `primary_sessions` row
  (`pending-checkpoints.ts`), with a three-state slot, a transactional take, and a depth that
  survives a restart. `runTurnWithContinuations:80-97` reports the survivor and *keeps* it: the
  promised continuation runs after the next genuine turn. This closes round-1 C1 properly — the
  columns live on `primary_sessions`, not `chat_sessions`, so a compaction swap cannot duplicate a
  pending continuation onto a fresh segment (a real hazard the design avoided).
- **The denominator.** `chat_sessions.lastContextWindow` is written on every usage report with the
  *chosen-model-first* rule (`handle-usage-reported.ts:79`), copied forward by **both** swap writers
  (`record-swap-segment-session.ts:115`, `handle-session-started.ts:158`), and read through one
  helper with a chain fallback (`segment-context-window.ts`). So a small-model delegated visitor no
  longer lowers what a 1M-window chain is measured against, and a fresh swap segment is no longer
  measured against the 200k floor. The overview meter reads the same value
  (`compose-overview-entry.ts:137`).
- **The stray-vs-survivor split.** `run-turn-with-continuations.ts:91-97` and
  `run-report-delivery-tick.ts:495-511` both implement it: an `autoContinue:false` turn owns only a
  checkpoint left **during** it (`checkpointedAt >= startedAt`); a survivor from before belongs to
  the user's next real turn. G-3's recipe landed verbatim, including the visible warn.
- **The visible drop.** Every non-continuing exit writes a user-facing row
  (`drop-pending-checkpoint.ts`), take + note in one transaction.

**Where it can still break, ranked:**
1. **B4** — a handed-over slot whose follow-up dies outside its own claim is invisible forever, and
   the drop note that would explain it never fires. The single largest remaining continuity hole.
2. **B1** — a wedged channel turn holds `${userId}` forever, so the global identity's next boundary
   swap never runs and the brain rides to its ceiling.
3. **Concurrent global + voice on one cwd.** Still unexamined (recorded in §2 as a live-smoke item,
   not in scope). `resolveVoiceConversationTarget` and `resolveGlobalRootConversationTarget` both
   ground in the hidden user-data dir; the seeded-swap session (`run-seeded-swap-session.ts:77`)
   runs there too. Two concurrent seeded swaps in one cwd is the untested case, and the lock split
   is exactly what made it reachable.
4. **Three chain-walk homes** (§4.5) — they agree today; the day one gains a filter, they diverge.
5. **Carry tail budgeting.** G4 was supposed to SKIP an over-long line rather than `break`; verify
   at `build-continuity-context.ts` (the fix is present in the arc's file list; the behavioural
   consequence is only a slightly shorter carry either way).
6. **The census counts files, not calls** (§4.6).

**Improvements:** make the hand-over releasable (B4); extract one `resolveChainSegments(rows, id)`
and have all three walkers call it; count call sites in the census; emit the dropped-checkpoint note
as a live frame.

---

## 7. Score

| Axis | R1 | R2 | Why |
|---|---|---|---|
| Correctness | 6.5 | **8.5** | every round-1 silent-loss class is closed at the code level (L1, G2, V1, V2, V4, M1, T1, T3); the new server-side defects are narrower (a leaked slot, a mis-scoped feed begin) |
| Stuck-resistance | 5 | **8** | leases + heartbeat + runtime sweeper + a real pausable wall clock + `turn-queued` + the delivery yield. Held back by B1 (channels unbounded), B2 (schedules unbounded), B3 (queue side unbounded) and B12 (the clock unsticks the user, not the lock) |
| Settings integrity | 6.5 | **9** | two resolvers, one rule, `auto` everywhere, unconditional mode stamping, fit guard on every background pick, autoBuildout live on all four interactive paths. Only `fire-schedule.ts:139` and leaf-row hygiene remain |
| Observability | 7 | **7** | the *wire* is excellent — one vocabulary, one predicate, voice has a status. But the arc changed a universal field's meaning and left three readers keyed to the old meaning: **B14** (a P1 regression: the brain chip is dead and voice rails anonymously into the sidebar), **B15** (binding off the family), **B17** (the light greys out past the cap). No lock diagnostics. Net: no better than round 1 |
| Continuity | 8 | **9** | durable checkpoints done *right* (on `primary_sessions`, not copied forward), a persisted denominator, a visible drop, a census guard. B4 is the one hole |
| Voice | 5.5 | **7** | see §8. The POLICY envelope is genuinely finished and well-defended at the enforcement layer (auto ⇒ `decideCanUseTool` allows before any tier is consulted, so nothing can resurrect a card). But the OPERATIONAL envelope moved rather than closed: the shipped daemon watchdog guards a path unreachable at default config (**V-N0**), the default surface — the browser overlay — has no turn bound and **no Stop at all** (**V-N2**), and the call leg silently discards its own answer after its watchdog fires (**V-N3**) |
| Tests | 7.5 | **8** | the seams now have real tests (hard-cap, wall clock with fake timers, continuity census, idempotent delivery, identity match). Two problems: the headline hard-cap suite is **flaky** (B18), and `use-working-rail.test.ts:52` *passes* while defending a frame no producer can emit — the exact shape that let B14 through |
| Code health | 8 | **8** | the WHY-comments remain exceptional and now carry the arc's incident dates. `run-task-job.ts` 415 lines, `run-report-delivery-tick.ts` 577, `session-turn.ts` 521 — over the cap, recorded as deferred. Two new false load-bearing comments (B10, and `NodesView.vue:108-109`) |
| **Overall** | **7** | **7.5** | |

**Why 7.5 and not 9+.** Three reasons, different in kind.

1. **The arc's own bar is not met.** §4 says *"No unbounded wait anywhere a turn can park: every
   approval/ask/lock/turn has a bound and an owner."* Two production paths still park with no bound
   and no owner — every channel turn (B1) and every schedule fire (B2) — and both hold or contend
   for the `${userId}` root lock that the entire G1 cascade runs through. Neither is exotic:
   Telegram is shipped, schedules are a headline feature. A third (B3) is a regression in *wait
   time* introduced by the correct L1 fix, and a fourth (B12) means the clock frees the user without
   necessarily freeing the lock.
2. **The arc changed the meaning of a universal field and did not sweep its readers.**
   `primarySessionId` went from "present only on some turns" to "present on every global and voice
   turn" — the fix for V2 — and three readers still key on the old meaning (B14, B15, B17). B14 is a
   user-visible regression the arc *introduced*, in a file inside the owning slice's declared
   scope, beside the new helper, defended by a test that passes on an impossible frame. That is the
   precise failure mode a green gate cannot see, and it is why Observability does not improve.

3. **The bounds landed on the legs that were audited, not on the legs that run.** The voice watchdog
   guards `#runTurn`, which `VYNEL_VOICE_JARVIS_WINDOW=1` (the default) makes unreachable, while the
   browser overlay — the surface every wake actually reaches — got no turn bound and no Stop path at
   all (V-N0, V-N2). The call leg's watchdog is reachable and introduces a *new* silent-loss bug
   (V-N3). This is the same shape as B1/B2 on the server: the bound was written where the reviewer
   was looking.

Everything else is genuinely excellent, and I want to be clear how much: the server core is now a
well-bounded, restart-safe, single-writer machine with two settings resolvers implementing one rule,
a durable continuity register designed *correctly* (on `primary_sessions`, so a swap cannot
duplicate a pending continuation), a persisted context denominator, a census guard that makes
continuity unforgettable, and one identity vocabulary on the wire. Seven of nine round-1 P1s are
closed at the code level. The arc did the hard half.

**+0.5 → 8:** V-N2 + V-N3 (the two voice paths that silently lose the user's answer) and B14 (sweep
the three rail/panel readers, re-fixture the test).
**+1.5 → 9:** the above, plus B1 and B2 (each is one call to an existing helper), V-N0 (bound the
overlay leg or flip the default), and B4 (one `dropPendingCheckpoint` from the settle paths).
**+2.5 → 10:** the above, plus a bounded/cancellable `acquire` (B3), a lock release that does not
depend on the provider honouring an interrupt (B12), the CAS results actually read (B9), one
chain-walk home, lock diagnostics, terminal precedence in the turn fold (B16), an honest `onSpeak`
resolution so dropped speech is observable at all, and the absence-contract pinned by a test (§4.9).

---

## 8. Voice session review

**The POLICY envelope is finished; the OPERATIONAL one still is not — it moved.** Every round-1
voice P1 is closed in code (tier, cards, identity, status, Stop-routing, auto-continue):

| r1 | Closed by |
|---|---|
| V1 call leg runs `ask` | `session-turn.ts:106-113` — `input.voice` routes to `resolveVoiceTierSettings`; `:303` gates the write-through; `call-session-client.ts:45-48` sends `{model, thinkingEffort, mode: VOICE_MODE, voice: true}` as belt-and-braces |
| V2 feed identity | `global-root-turn.ts:334-339` — `scopeKind: isVoiceTurn ? 'voice' : 'global'` **+ `primarySessionId` on every begin**; `match-turn-to-identity.ts` is the one reader |
| V3 no status | `fold-session-chains.ts:66-68` admits voice; `get-sessions-overview.ts:46,89-93` drops it from lists and serves it through `getVoiceChatOverviewEntry` only |
| V4 Stop hits global | `routes/root/interrupt.ts:60-73` — optional owner-checked `sessionId`, `INTERRUPTIBLE_SCOPES = {global, voice}`, 404 on anything else; `use-chat-turn.ts:325` passes `activeSessionId` |
| V5 auto-continue vs departed daemon | `global-root-turn.ts:444-446` — `autoContinue: false` on every voice turn |
| V6 dead `onSpeak` branch | `apps/voice/src/main.ts:156-162` — the handed-off branch publishes, and falls back to native when the overlay is gone; the coupled web half is present (`use-voice-daemon-link.ts:40,79` + `JarvisView.vue:30` / `VoiceOverlay.vue:23` both pass `isPlayingOwnTurn: () => voice.isActive.value`) — **both halves landed, so no double-play regression** |
| V7 typed vs spoken split | one tier, forced server-side on both `/root/turn` and `/sessions/:id/turn`; `updateChatSessionSettings` 403s a voice row |
| W1 (voice half) unbounded cards / asks | `auto` ⇒ `approvalFloorStandsDown` ⇒ `decideCanUseTool` returns `'allow'` before any tier is consulted (`tool-approval-policy.ts`); `ask_user` is not attached at all (`global-root-turn.ts:217-227`) |
| daemon deadline | `loop/turn-watchdog.ts` (`AbortController` + `unref`ed timer + `whenExpired`), `brain/run-brain-turn.ts:86-108` (caller signal → controller, plus a separate **connect deadline** at `:94`) |
| `mapFrameToBrainEvent` recoverable-as-failed | `run-brain-turn.ts:38-46` — `isRecoverable === true ? 'retrying' : 'failed'` |
| `turn-queued` unrendered | `run-brain-turn.ts:23` maps it; `voice-session-driver.ts:297-302` speaks it **once per turn** |

**But the envelope was finished on the leg users do not run.** Three NEW P1s and one config fact
change the picture:

**V-N0 (P1) · The shipped daemon watchdog protects a code path that is unreachable at default
config; the leg users actually hit — the browser overlay — got no bound and no Stop.**
*Where:* `apps/voice/src/env.ts:85` — `VYNEL_VOICE_JARVIS_WINDOW: z.enum(['0','1']).default('1')` ·
`apps/voice/src/main.ts:129,235` — `jarvisEnabled = env.VYNEL_VOICE_JARVIS_WINDOW === '1'`,
`shouldHandOff: () => jarvisEnabled || overlay.hasClient` ·
`apps/voice/src/loop/voice-session-driver.ts:234-240`
```ts
if (this.#deps.wakeHandoff?.shouldHandOff() === true) {
  this.#state = 'handed-off'
  this.#deps.wakeHandoff.publishWake(wake.command)
  return true            // ← #runTurn is never reached
}
```
At the default, every wake hands off, so `#runTurn` — and with it `armTurnWatchdog`,
`STILL_WORKING_LINE` and the `turn-queued` "one moment" — never executes. (The `state === 'active'`
branch that also calls `#runTurn` is only reachable after `#goActive()`, which the handoff path
skips.) So the arc's headline daemon bound is live only with `VYNEL_VOICE_JARVIS_WINDOW=0`.
*CONFIRMED* — read `env.ts`, `main.ts` and the driver's wake branch.

**V-N2 (P1) · Closing the overlay does not stop the server turn, and then the reply speaks with no
UI.** `apps/local-web/src/composables/voice/voice-command-session.ts:159-166` — `end()` is
`turnAbort.abort(); deps.abortCapture(); deps.cancelSpoken()` and nothing more. `grep -rn interrupt
apps/local-web/src/composables/voice apps/local-web/src/components/voice` returns only
`voice-turn-adapter.ts:49-50` (an inbound event mapping) — **no client ever calls
`root.interruptTurn`**, though the identity-shaped door exists and
`DesktopControlOverlayView.vue:143-161` shows the right shape. Second order: once `end()` flips
`voice.isActive` false, the relayed-speak guard at `use-voice-daemon-link.ts:79` **opens**, so the
still-running turn's `speak` plays through the daemon-link's own player — a different instance from
the one `cancelSpoken()` reaches. *Failure:* the user closes the overlay mid-turn; the window
vanishes, the turn runs to completion, and the full answer speaks aloud with no UI and no way to
stop it. *CONFIRMED.*

**V-N3 (P1) · On a live call, the watchdog silently discards the real answer.**
`apps/voice/src/call/call-conversation.ts:212-221` — the watchdog speaks
`CALL_TURN_STILL_WORKING_LINE` and calls `handBack()`, which clears `#turnInFlight` and starts the
next pending turn. Turn #1 keeps streaming and later does `await this.#speak(spoken)` (`:247`).
`packages/voice/src/relay/line-speaker.ts:52-54` **throws** `"speakLine while a line is in flight"`,
and `call-conversation.ts:294-300` catches it and logs "call speech failed — the line was not
heard". *Failure:* watchdog fires → a participant speaks → turn #2 starts speaking → turn #1's
answer lands → thrown, swallowed, gone. If they do not overlap, both speak and a stale answer
arrives after a fresh one. Unconditional — no config gate; this runs on every call. *CONFIRMED.*

**V-N4 (P1) · Two open windows both play the same relayed `speak`.**
`apps/voice/src/overlay/overlay-channel.ts:229-234` picks the **newest subscriber of any surface**
(`for (const stream of subscribers.keys()) target = stream`), while the `isPlayingOwnTurn` guard is
per-window (`JarvisView.vue:30` and `VoiceOverlay.vue:23` each pass their own `voice.isActive`), and
`<VoiceOverlay />` is mounted unconditionally in `AppShell.vue`. So when Jarvis owns the wake
session and the app window connected later, the daemon relays the line to the app window, whose
guard is false — two speakers, same line, out of sync; or the owner window never gets it at all.
*CONFIRMED by the subagent's trace; the target-selection loop and the two mount sites re-read here.*

**The queue consequence — NEW, P2 (restated for the config that is actually shipped):**

**V-N1 · After a watchdog hands the room back, the abandoned server turn still holds the voice root
lock, so every following utterance queues behind it for up to an hour.** (Reachable on the CALL leg
unconditionally, and on the daemon leg only with `VYNEL_VOICE_JARVIS_WINDOW=0` — see V-N0.)
*Where:* `apps/voice/src/loop/voice-session-driver.ts:272-281` (on expiry: `#leaveTurn()` → mic open,
"still working", **nothing cancels the server turn**) · `packages/session/src/runtime/run-global-root-turn-core.ts:95-96`
(`runUnderRootTurnLock(rootTurnLockKey(userId, true), …)` wraps the WHOLE turn) ·
`apps/local-api/src/streams/global-root-turn.ts:373-374` (the only ceiling is
`VYNEL_INTERACTIVE_TURN_MAX_MS`, default **3 600 000 ms**).
*Trace:* wake → `#runTurn` arms `armTurnWatchdog(VYNEL_VOICE_TURN_WATCHDOG_MS)` (5 min) → fires →
`#leaveTurn()`/`goActive()` → user speaks again → `#runTurn` → `runBrainTurn` POSTs `/root/turn
{voice:true}` → `isRootTurnLockBusy(rootTurnLockKey(userId, true))` is true →
`turn-queued {reason:'busy'}` → daemon speaks "one moment" → the request parks **inside the core**
until turn #1 settles → 5 min later watchdog #2 fires → "still working" → repeat.
*Failure scenario:* one long spoken request (a big research turn) makes the voice thread answer
every subsequent utterance with "one moment … still working" for up to 60 minutes, with no spoken
way out. The hands-free user's only lever is the Voice Stop button in an app they are not looking
at. The watchdog's own header is honest about this ("bounds the daemon's OWN wait, never the
server's") — the consequence for a single-writer thread was not carried through.
*Minimal fix:* on watchdog expiry, POST `/root/turn/interrupt { sessionId: <the voice head> }` (the
door exists, is owner-checked and admits `voice`), or let the next wake preempt by interrupting
before it sends. Product call: "keep working and tell me later" (today) vs "you took too long, new
request wins".
*CONFIRMED* — every hop read; `isRootTurnLockBusy` + `runUnderRootTurnLock` are the same key
(`rootTurnLockKey`), and the daemon never calls any interrupt door (`grep -n "interrupt" apps/voice/src`
returns nothing on the driver path).

**Other voice observations:**
- **B5** (§1) — the live CALL leg announces `scopeKind:'global'`, so the Voice surface shows nothing
  live during a call and the call is attributed to the Global area.
- **Continuity is applied on the voice thread**: `run-global-root-turn-core.ts` is a census runner,
  so `withBoundaryContinuity` rides the voice stream; swap segments inherit `scope: 'voice'` (both
  swap writers carry `scope` forward), so a compacted voice chain stays behind the wall. With
  `autoContinue: false`, a checkpoint the model leaves during a voice turn is **dropped visibly**
  (`run-turn-with-continuations.ts:104-107` → the note on the voice head) and a survivor from before
  is left alone — the right split for a thread nobody is reading.
- **Global + voice share one cwd** (`resolve-global-root-conversation.ts:44,58` both return
  `resolveGlobalRootWorkspacePath()`), and the lock split is exactly what made concurrent seeded
  swaps in that cwd reachable. Still formally unexamined; the transcript layouts under it are
  session-keyed (`.vynel/transcripts/<sessionId>/`), so a collision is *PLAUSIBLE-safe* rather than
  verified. Kafi's live smoke stands.
- **The wall holds** on every server reader I probed: the sessions overview drops voice
  unconditionally (so `list_sessions` cannot reach it), the interrupt door's scope allow-list is
  `{global, voice}` and 404s the rest, and the settings PATCH 403s a voice row.

**Further voice defects worth carrying (traced by the dedicated sweep, spot-checked here):**
- **P2 · A proactive `speak` during a Jarvis handoff destroys the pending wake → permanently deaf
  daemon.** `overlay-channel.ts:219-222` clears `pendingWake` on any non-`wake` state; the driver's
  own `#speakLine` publishes `'speaking'`. A scheduled `speak` in the window between
  `jarvisWindow.open()` and the client's connect nulls the pending wake, the connect replays
  nothing, and the 10 s connect watchdog does not `endHandoff()` because `hasWakeTarget` is still
  true. Driver stuck `handed-off` until restart — the exact class the arc set out to kill.
- **P2 · Server-side, a Stop with no `sessionId` still resolves the GLOBAL primary**
  (`routes/root/interrupt.ts:75-80`). "A voice-surface Stop with no known session sends nothing" is
  enforced only client-side (`use-chat-turn.ts:305-311`) — a CLI or a stale desktop build still
  kills the global thread while a voice turn runs.
- **P2 · The daemon watchdog and the server wall clock measure different intervals.** The daemon
  arms at `#runTurn` entry so queue time counts; the server arms inside `resolveTarget` (in-lock) so
  it measures hold time only. A voice turn queued 4 minutes is abandoned 1 minute into execution.
- **P2 · A relayed `speak` is dropped for the whole overlay session, not just while playing.**
  `isPlayingOwnTurn` is fed by `voice.isActive`, true from wake until end (including the idle-listen
  window), and `main.ts:157` already returned `true` so there is no native fallback. Wider than the
  locked "skip while it is playing its own turn".
- **P2 · `/voice/synthesize` has no timeout** (`spoken-audio-player.ts:62-67`) — a hung daemon
  leaves `play()` pending forever, so `run()`'s finally never posts `/voice/session/end` and the
  daemon stays handed-off and deaf.
- **P2 · A voice-initiated delegation reports to the GLOBAL thread and is never spoken**
  (`dispatch-message.ts:111-114` → `findGlobalPrimarySessionForUser`;
  `run-report-delivery-tick.ts:233,279` only ever consult `rootTurnLockKey(userId, false)`).
- **P3 · `onSpeak` resolves before anything is heard** (`main.ts:172` returns
  `Promise.resolve()` where `overlay-channel.ts:45` documents "resolves once the speaker has
  drained"), so the `speak` tool always reports `spoken: true` — **which is why every dropped-speak
  path above is invisible to the model.**
- **P3 · A user Stop makes voice apologise** — `run-brain-turn.ts:48-50` maps `session-interrupted`
  → `failed` → the driver speaks "Sorry, I ran into a problem with that."
- **P3 · The watchdog's documented off-switch is unreachable** — `turn-watchdog.ts:23-24` says
  `timeoutMs <= 0` disables it; `apps/voice/src/env.ts:79` is `.positive()`, so boot rejects 0.
- **P3 · The global↔voice read lift is BIDIRECTIONAL and only one direction is tested.**
  `turn-session-header.ts:56-60` accepts either scope, and `sessions/index.ts:278`'s
  `forbiddenScopes: fromGlobalRoot ? [] : [...]` lifts the wall entirely, so a typed Global (or
  Telegram-driven) turn can `search_chat_messages` into the spoken transcript and then
  `get_chat_session` it. This is **documented as deliberate** (`turn-session-header.ts:51-55`,
  "each may read the other — Kafi's model") and pinned by `chat-search.test.ts:200-206`; the finding
  is that it predates the arc's voice wall and only voice→global is covered by a test. A decision,
  not a silent fix.

**Ranked voice improvements:** V-N2 (overlay Stop → the server) → V-N3 (the call leg's dropped
answer) → V-N0 (bound the leg users actually run, or flip the default) → V-N4 (route the relayed
speak to the owning surface) → the deaf-daemon wake race → V-N1 → server-side Stop scoping → B5
(call-leg feed scope) → `onSpeak` resolving honestly, which makes the rest observable.

**The remaining open forks — verdicts:**

| Fork | Verdict |
|---|---|
| `direct_to_user` answers reach only the global catch-up net | **Now worth doing, and cheap.** Round 1 said "right problem, not first" because G2 (catch-up consumed by a turn that never ran) and V6 (dead `onSpeak`) were larger holes through the same surface. Both are closed (`markCatchUpSurfacedOnSessionStarted`; the published handed-off branch). The prerequisite work is done. |
| Voice-fired TASKS parent on the global conversation | **Still correct as-is.** Round 1's reason ("the only thing keeping a voice-fired task visible") has weakened now that voice has status facts, but the delivery of a voice-fired task's report belongs on the thread the user reads, and that is global. Leave it; revisit only if voice gains its own reading surface. |
| Per-call sessions gain the routing toolset | **Unblocked — the prerequisites landed.** Round 1's gate was "not until V1 + W1": V1 is closed at `session-turn.ts:106-113` and the call leg now runs `auto`, so a routing tool on a live call cannot card. The one thing to check first is B5 — a per-call session that routes will announce `scopeKind:'global'`, so its delegations will be attributed to the Global area on the feed. |
| Split the 503-line `routes/root/index.ts` | **Done** — 209 lines + `interrupt.ts` (82) + `voice-chat.ts` (122) + `delegations.ts` (224). |

---

## Round-1 P1 closure table

Every verdict cites the **code**, not the arc note.

| r1 ID | Finding | Verdict | Closing code |
|---|---|---|---|
| **L1** | Delegation timeout releases the target lock under a live turn | **CLOSED** | `route-request.ts:99-156` — the envelope settles only when the delegate settles; the cap fires `onHardCap` (cancel lever → SDK interrupt) and the coordinator *keeps awaiting*, returning `capped`. `delegation-service.ts:188-209` releases the key in the run promise's own `.finally`, and `run-task-job.ts:360-380` settles `capped` with `neverRequeue: true`. Regression suite: `run-delegation-claim-and-run-tick.hard-cap.test.ts` (452 lines) |
| **V1** | Voice CALL leg runs `ask` | **CLOSED** | `session-turn.ts:106-113` (`isVoiceTurn` → `resolveVoiceTierSettings`, fit-clamped) · `:303` (no write-through) · `call-session-client.ts:38-48` (`voice: true` + the tier) |
| **V2** | Voice turn announces as global with no `primarySessionId` | **CLOSED** | `global-root-turn.ts:334-339` (scope + primary id on every begin) · `match-turn-to-identity.ts` (one predicate) · `activity-store.ts:35,45,86` · `use-session-statuses.ts:58,66` · `use-continuing-conversation.ts:66-69` |
| **V3** | Voice chain never enters the overview → no status anywhere | **CLOSED** | `fold-session-chains.ts:66-68` (admits voice) · `get-sessions-overview.ts:46` (lists drop it) · `:89-93` (`getVoiceChatOverviewEntry`) |
| **W1** | Card-less surfaces inherit unbounded human-waits | **PARTIAL** | Voice: **closed** (`auto` ⇒ `approvalFloorStandsDown` ⇒ allow; no `ask_user` attached). Channels/deliveries: **closed on the card** (`row ?? auto`) and bounded on the ask (10 min). **OPEN on schedules** — `fire-schedule.ts:139` still `bypass-with-behavior-gate` (**B2**). The daemon deadline **built but reachable only at `VYNEL_VOICE_JARVIS_WINDOW=0`** (`turn-watchdog.ts` + `run-brain-turn.ts:86-108`, armed in `#runTurn` which the default config skips — **V-N0**); the default overlay leg has no bound (**V-N2**) |
| **G1** | A parked ask/approval on the interactive global turn wedges the `${userId}` root lock | **PARTIAL** | Interactive half **closed**: `turn-wall-clock.ts` on all three streams (working-time budget, suspended while parked), `VYNEL_INTERACTIVE_ASK_MAX_MS` + the 60 s `asks-recovery-service.ts`. Background half **OPEN**: `run-global-root-turn.ts` has no wall clock and no `routeRequest` wrapper (**B1**) |
| **G2** | Catch-up reports marked surfaced before `startChatSession` | **CLOSED** | `run-global-root-turn-core.ts:260-271` + `markCatchUpSurfacedOnSessionStarted:344-356` — marked on the first `session-started`, best-effort so a failed mark re-injects rather than loses |
| **V4** | Voice-panel Stop interrupts the GLOBAL primary | **CLOSED** | `routes/root/interrupt.ts:60-73` (owner-checked `sessionId`, `INTERRUPTIBLE_SCOPES`) · `use-chat-turn.ts:325` · `DesktopControlOverlayView.vue:143-161` (identity-keyed Stop: delegation / voice id / global head, else refuses) |
| **M1** | Fit guard has one caller | **CLOSED** | `resolve-background-turn-settings.ts:76-93` fit-clamps **every** background pick (task / note / agent-run / delivery, incl. `agent.model` via `fallbackModel`) · `run-global-root-turn.ts:269-282` (channels) · `interactive-turn-settings.ts:84-97` (voice) |

**Round-1 P2s spot-checked:** S1 lease — **CLOSED** (`claimNextPendingDelegationJob` stamps
`leaseExpiresAt`, `delegation-lease-heartbeat.ts`, 60 s sweeper, `env.ts:187-192` refuses an
unrenewable heartbeat); *bounded `acquire`* — **STILL OPEN** (B3). S2 `turn-queued{busy}` —
**CLOSED** (`global-root-turn.ts:401-406` via `isRootTurnLockBusy`). V5 — **CLOSED**
(`autoContinue: false`). V6 — **CLOSED, both halves**. D1 delivery rail — **CLOSED** (global branch
marks its gate at `run-global-root-turn.ts:538-553`; capped delivery is recoverable at
`run-report-delivery-tick.ts:542`; retry is idempotent via `insertChatMessageIfAbsent`; the slot
yields at `:273-291`). D2 note/direct rows destroyed by restart — **CLOSED**
(`ORPHAN_REQUEUE_JOB_KINDS = ['report-delivery','direct-delivery','note']`). C1 process registers —
**CLOSED for checkpoints** (durable on `primary_sessions`), deliberately in-process for
`swapping-primaries` (a crash leaves nothing to clear). T1 mode inversion — **CLOSED** (all three
streams stamp unconditionally). T2 birth-stamp — **PARTIAL** (spawned closed; `record-leaf-session.ts`
still NULL, behaviourally masked). T3 agent-run effort — **CLOSED**. T4 `autoBuildout` — **CLOSED**
on all four interactive paths + both background resolvers. N1/N2/N3/N4 — **CLOSED**.
`/activity/running` — **REMOVED**. Carry tail `break` — **CLOSED** (`build-continuity-context.ts:161-171`
skips, with a budget-free omission marker).

**Net: 7 of 9 round-1 P1s fully closed; 2 (W1, G1) closed on their user-facing half and open on the
background half — and those two halves are the same defect, B1/B2. The daemon-deadline half of W1
was built but lands on a code path the default config never runs (V-N0).**

---

## Method + working-tree state

Traced depth-first from the assigned entry point (interactive workspace + spawned streams) through
the delegation engine, the delivery rail, channels, schedules and continuity — reading whole files
and following imports. Two focused read-only sweeps ran in parallel on the voice daemon and on the
web monitoring/nodes layer; **every P1 and every P2 I carried from them is re-read and re-traced
here before being marked CONFIRMED** (V-N0 at `env.ts:85` / `main.ts:129,235` /
`voice-session-driver.ts:234-240`; V-N2 at `voice-command-session.ts:159-166` plus a repo-wide grep
for `interrupt` under `composables/voice` + `components/voice`; V-N3 at `line-speaker.ts:52-54` +
`call-conversation.ts:212-221,247,294-300`; B14 through `use-working-rail.ts` → `WorkingRail.vue` →
`LiveSessionPane.vue` → `SessionThreadView.vue` → `useSessionDetail`; B15 and the NodesView level
stack read directly). Anything I could not re-trace is marked PLAUSIBLE.

One finding (B4) was reproduced by a throwaway vitest, which passed and was **deleted**. My own
`git status --short` is clean. The worktree is shared with the other four round-2 agents, so it
shows their in-flight throwaway files (`audit-r2-agent-3-*.test.ts`, `audit-r2-agent-4-*.test.ts`);
I left those alone rather than destroy live work.

## Top 10 ranked

| # | ID | Sev | One line | Where | Status |
|---|---|---|---|---|---|
| 1 | **B1** | P1 | Channel-originated global turns have no wall clock and no hard cap — a wedged provider holds `${userId}` forever, stalling channels, deliveries and the user's own global turn | `sessions/run-global-root-turn.ts:243-522` · `services/channels-service.ts:89-102` | CONFIRMED · r1 G1 half-open |
| 2 | **V-N2** | P1 | Closing the voice overlay never stops the server turn — the reply then speaks aloud with no UI and no way to stop it (no client anywhere calls `root.interruptTurn`) | `composables/voice/voice-command-session.ts:159-166` · `use-voice-daemon-link.ts:79` | CONFIRMED |
| 3 | **B14** | P1 | The working rail still branches on `primarySessionId != null`, which the arc made universally true — the documented brain chip is dead and a voice turn rails as a nameless "Working…" chip that opens the spoken transcript | `composables/activity/use-working-rail.ts:127-155` · producers `run-global-root-turn.ts:410`, `global-root-turn.ts:336` | CONFIRMED · regression the arc introduced |
| 4 | **V-N3** | P1 | On a live call the watchdog hands the room back, then turn #1's real answer throws inside `LineSpeaker` and is swallowed — silently discarded | `apps/voice/src/call/call-conversation.ts:212-221,247,294-300` · `packages/voice/src/relay/line-speaker.ts:52-54` | CONFIRMED |
| 5 | **B2** | P1 | Schedule fires still hardcode `bypass-with-behavior-gate`, so they card the floor with nobody watching — and that path has no bound either | `packages/schedules/src/firing/fire-schedule.ts:139` | CONFIRMED · contradicts D3 + §2 |
| 6 | **V-N0** | P1 | The shipped daemon watchdog guards `#runTurn`, unreachable at the default `VYNEL_VOICE_JARVIS_WINDOW=1`; the leg users run (the overlay) has no bound at all | `apps/voice/src/env.ts:85` · `main.ts:129,235` · `voice-session-driver.ts:234-240` | CONFIRMED |
| 7 | **V-N4** | P1 | The overlay channel relays `speak` to the newest subscriber of ANY surface while the de-dupe guard is per-window — two windows play the same line, or the owner gets nothing | `apps/voice/src/overlay/overlay-channel.ts:229-234` · `JarvisView.vue:30` / `VoiceOverlay.vue:23` | CONFIRMED |
| 8 | **B4** | P2 | A handed-over checkpoint slot leaks forever when its follow-up job is settled by anything but its own claim — no survivor, no visible drop note | `continuity/pending-checkpoints.ts:157-179` · `services/delegation-orphan-settlement.ts:38` | **REPRODUCED** (throwaway vitest, deleted) |
| 9 | **B3 / B12** | P2 | The queue side of every lock is unbounded (and the correct L1 fix stretched the worst case from ~10 min to 60), and the wall clock frees the user without necessarily freeing the lock | `delegation/session-target-locks.ts:28-35` · `runtime/turn-wall-clock.ts:127-141` | CONFIRMED |
| 10 | **B15 / B17 / V-N1 / B5** | P2 | `TasksPanel` binds a session off the `global` FAMILY by insertion order · the shell light loses `problem` past the 50-row cap · a watchdog-abandoned voice turn queues the next utterance for up to an hour · a live CALL announces `scopeKind:'global'` | see §1, §5, §8 | CONFIRMED |

*Below the cut but worth carrying:* B16 (no terminal precedence in the turn fold → a wall-clock cut
can read as the user's Stop) · B18 (the arc's headline hard-cap suite is flaky) · §4.5 (three
independent chain walks) · B9 (CAS results discarded) · the deaf-daemon wake race · the
bidirectional global↔voice read lift with only one direction tested · B11/B6/B7/B8/B10 (latent
single-subscriber gate · `interrupted: true` always · misworded drop note · the clock armed outside
the zombie-turn guard · two new false load-bearing comments).

## Verified clean (don't re-spend budget)

- The delegation lock lifetime, the hard cap, the cancel lever, the lease + heartbeat + sweeper, and
  the CAS-on-claim at the repository layer.
- `DEFAULT_SESSION_MODE = 'auto'` is consistently applied — a full sweep for `?? 'ask'` and
  `?? 'bypass-with-behavior-gate'` fallbacks found only the two documented deliberate homes (leaf
  sessions, the seeded-swap priming session) and the one gap (B2).
- The unconditional delegation-mode header on all three interactive streams.
- The find-or-insert idempotency of the inbound row (`insertChatMessageIfAbsent` + three call sites)
  and the stable delivery-job-id-as-inbound-id.
- The durable checkpoint register's design: the columns live on `primary_sessions`, so a compaction
  swap cannot duplicate a pending continuation onto a fresh segment.
- Both swap writers copy `scope` and `lastContextWindow` forward.
- The continuity census (5 ↔ 5 + a pinned roster).
- Voice **policy**: the tier is forced on all four legs and provably cannot card — `auto` makes
  `decideCanUseTool` return `'allow'` and `requiresApprovalCardBackstop` return `false` *before* any
  tier is consulted, so `mutatingToolNames`, `askModeApprovalToolNames`, `start_call`'s
  `askApproval` and a user tool-policy `cardClass: 'always'` are all inert on voice. The chips are
  genuinely inert markup (`ChatComposer.vue` renders `<span class="locked-chip">`), not just
  annotated. The overlay double-speak fix landed as **both** halves.
- Voice **wall** on the write side: `findRoutableSessionBySegmentId` refuses anything but
  `spawned`/`agent`, `parseMessageDestination` has no voice address, notes cannot target voice, and
  reports never land in voice — the wall does not depend on a filter because the door does not
  exist. `foldSessionChains` has exactly three call sites, all in `get-sessions-overview.ts`, and
  `listableChains` is shared by the list and the count so they cannot disagree. (The one deliberate
  exception is the documented bidirectional global↔voice **read** lift — see §8.)
- The watchdog's core premise: aborting the daemon's SSE read genuinely does not kill the server
  turn (hono's `StreamingApi.write` swallows write failures), and there is no watchdog/completion
  double-fire (`Promise.race` + `disarm()` + the `expired` check drain in one microtask turn).
- `SessionTargetLocks` release idempotency, `runUnderRootTurnLock` chaining on both outcomes, and
  `activityHandle.end` idempotency.

