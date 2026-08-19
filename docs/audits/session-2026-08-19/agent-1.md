# Vynel SESSION SYSTEM — deep audit (agent 1)

Worktree `E:\KLONE\Workspace\vynel\.claude\worktrees\session-audit` @ `06781328`.
Entry point per brief: the interactive workspace + spawned paths, widened to global / voice /
delegation / continuity / monitoring UI. **CODE, not docs** — where a doc and the code disagree the
code is quoted. `KNOWN` = already recorded in `.claude/STATE.md` or a module note; `NEW` = not.

Severity: **P0** blocker · **P1** major · **P2** minor · **P3** nit.

---

## 1. Bugs for session — all scopes (Global · Workspace · Spawned · Agent · Voice · channels)

### A1 · P1 · workspace + spawned + agent · the delegation wait-timeout frees the single-writer lock while the turn keeps writing — NEW · CONFIRMED

**Where**
- `packages/session/src/delegation/run-delegation-claim-and-run-tick.ts:81`
  `const DELEGATION_RUN_BUDGET_MS = 600_000`
- `:651-663` the budget is handed to `routeRequest` as `timeoutMs`
- `packages/orchestration/src/routing/route-request.ts:17-20`
  `// The timeout is "stop WAITING", NOT "stop the target": on timeout we return a timed-out envelope, but the routed turn keeps running in its own SDK session.`
- `route-request.ts:138` `const outcome = await Promise.race([delegationPromise, wait.promise])` — the delegate promise is never cancelled or awaited
- `run-delegation-claim-and-run-tick.ts:818-824` timed-out branch → `activityHandle.end('failed')`, `failDelegationJob(...)`, `return true`
- `apps/local-api/src/services/delegation-service.ts:204-215`
  `.finally(() => { if (claimedTargetKey !== null) { activeRunCount -= 1; if (releaseTargetLock !== null) releaseTargetLock() ... } })`

**Failure scenario.** A delegated task on workspace `W` runs past 10 minutes (a "fix the whole feature"
task; STATE.md already records 100 s turns as ordinary). `routeRequest` resolves `timed-out`; the tick
fails the job and returns; the pool's `.finally` releases target key `W` **while the turn is still
inside `delegateToWorkspaceRoot`** — which resolved `W`'s primary at
`packages/session/src/delegation/delegate-to-workspace-root.ts:142` and will run
`withBoundaryContinuity` at `:234`. From that instant:

1. the pool can claim the next `W` job (its exclusion set is `targetLocks.busyKeys()`,
   `delegation-service.ts:185`), and
2. a user continue-turn acquires the freed key at `apps/local-api/src/streams/chat-turn.ts:488` and
   resumes the *same* `currentSdkSessionId`.

Two concurrent `--resume <id>` writers on one CLI session is precisely the interleaving
`packages/session/src/runtime/root-turn-lock.ts:1-11` names ("two channel messages would concurrently
resume + swap the same root session → one turn's messages orphan"), and the zombie's boundary swap
repoints the primary under the new turn's feet — the new turn then writes to a superseded segment.

**Fix (minimal).** Hold the target key until the *delegate promise* settles, not until `routeRequest`
returns. Either have `routeRequest` hand the still-pending `delegationPromise` back with the
`timed-out` envelope and let the tick `await` it before returning (the job row can be marked
timed-out immediately — only the LOCK must outlive it), or interrupt the abandoned run through the
`DelegationCancelRegistry`. The row bookkeeping is already correct; only the lock lifetime is wrong.

### A2 · P1 · voice (call leg) + spawned · a voice CALL turn runs in ASK mode — NEW · CONFIRMED (repro)

Full trace + fix in §3 and §8 (it is primarily a settings-binding bug). Summary: the daemon's call
client posts `POST /sessions/:id/turn` with no `mode` onto a spawned session born with NULL settings,
so `session-turn.ts:95` falls back to `DEFAULT_SESSION_MODE = 'ask'` and the floor cards on a
hands-free surface with no card renderer.

### A3 · P2 · voice + global · a voice turn's pre-resolution window lights the GLOBAL Assistant as running — NEW · CONFIRMED

**Where**
- `apps/local-api/src/streams/global-root-turn.ts:321-325` — a VOICE turn's feed entry is
  `{ userId, scopeKind: 'global', origin: input.voice === true ? 'voice' : 'web' }` — **no
  `sessionId`, no `primarySessionId`**; the id only arrives via `sink.onEvent` (`:83-88`).
- `apps/local-web/src/composables/sessions/use-session-statuses.ts:51-56`

```ts
if (entry.scope === "global") {
  const brainTurn = turns.find((turn) => turn.scopeKind === "global" && turn.sessionId === null);
  if (brainTurn !== undefined) return brainTurn.startedAt;
}
```

  with the comment at `:49-50`: *"Safe to claim: every OTHER global-scope turn on the feed is a
  spawned session's, and those always carry their session id from the start."* — **that invariant was
  true before the voice arc and is false now.**
- `packages/contracts/src/chat/session-status.ts:95` `const errorStanding = !isRunning && facts.lastError !== null`
  and `:84-87` (a live turn supersedes a standing set-status).

**Failure scenario.** The global brain's last turn failed → the Assistant row and the shell's global
light are red (`problem`). The user says "hey vynel"; the voice turn announces globally with a null
session id for the whole engine-spawn window. `liveTurnStartedAtForEntry` returns its `startedAt` for
the *global* entry → `isRunning` true → `errorStanding` false → the red light flips to purple
"running" on a thread that is idle, then flips back. Symmetrically a standing `completed` /
`needs_input` on the global thread is superseded by a turn on a different thread.

The identical class was caught and fixed on the client poll in the arc's review round 2 —
`apps/local-web/src/components/chat/VoiceChatPanel.vue:42-44` reads *exactly*
`serverTurn.scopeKind === "global" && serverTurn.origin === "voice"`. This second reader was missed.

**Fix (minimal).** Two options, prefer the second: (a) add `&& turn.origin !== 'voice'` to the
fallback predicate; (b) stamp `primarySessionId: conversationTarget.primarySessionId` on the
`activityFeed.begin` in `global-root-turn.ts` (the value is already in hand at `:141`) so every reader
keys on identity instead of inferring from a null session id — this also gives the voice thread a
first-class liveness handle it does not have today (see §5).

### A4 · P2 · voice · `speak` from any non-overlay session is silently DROPPED while the Jarvis overlay is handed off — NEW · CONFIRMED

**Where** `apps/voice/src/main.ts:146-159`

```ts
onSpeak: (text) => {
  if (driver.isHandedOff) {
    logger.info({ text: text.slice(0, 80) }, 'speak — the live overlay session plays it')
  } else if (!driver.isAwake && overlay.publishSpeak(text)) { ... }
  else { driver.speak(text) }
  return Promise.resolve()
}
```

The `isHandedOff` branch does nothing but log. Its premise (`:139-141`) is that the overlay plays
speak calls *from its own turn stream* — true only for the overlay's own turn
(`apps/local-web/src/composables/voice/voice-turn-adapter.ts:38-43`).

**Failure scenario.** The voice-session arc added a THIRD `speak` producer on the voice thread: the
Voice chat panel's typed turn (`VoiceChatPanel.vue:73-78`, `useChatTurn` with `voice: true`), which
has no audio player of its own — plus scheduled briefings and any global session. `isHandedOff` spans
the *entire* overlay conversation window (`voice-session-driver.ts:105-107`; cleared only by
`endHandoff`), not just a turn. So: wake Jarvis, then type in the Voice chat panel (or let a schedule
fire) → the reply's `speak` is dropped and logged as if it were played. Text still lands in the panel,
so it is silent-not-lost — but the log line asserts the opposite, which will cost real debugging time.

**Fix (minimal).** Route by *producer*, not by driver state: the overlay's own turn already suppresses
re-routing at the client (its adapter plays what it saw), so the daemon can safely
`overlay.publishSpeak(text)` in the handed-off branch too — or, cheaper and honest, fall through to
`driver.speak(text)` and fix the log line. Either way the branch must not be a no-op.

### A5 · P2 · every scope · a delegated turn's explicit model pick has no fit guard — KNOWN (STATE.md residual)

**Missing guard: CONFIRMED.** `packages/session/src/runtime/fit-pinned-model-to-session.ts` has exactly
**one** production call site: `apps/local-api/src/streams/global-root-turn.ts:183`, gated on
`isVoiceTurn`. `delegate-to-workspace-root.ts:163-164`, `delegate-to-spawned-session.ts:174-175`,
`delegate-to-agent-session.ts:157-158` and `run-agent-run-job.ts:270-276` all pass `claimed.model`
straight through to the provider.

**Exploitability: PLAUSIBLE, not traced.** The failure I am reconstructing — a root picking a
small-window model for a task aimed at a fat primary, reproducing the 2026-08-19 incident on the
delegation rail — assumes (a) the root actually emits small-model picks on delegated tasks and (b) a
delegated resume of a fat primary fails the same way an interactive one did. I verified neither. The
STATE.md residual is accurate as recorded; my one addition is that the gap also covers
`run-agent-run-job.ts`'s `claimed.model ?? agent.model` fallback — an *agent's own configured model*
can be small and is never fit-checked either.

### A6 · P3 · all · `createApp` can silently split the lock domain — NEW · CONFIRMED

`apps/local-api/src/app.ts:230` `const sessionTargetLocks = options.sessionTargetLocks ?? new SessionTargetLocks()`.
Production always injects (`boot.ts:211` → `:265` and `:407`), so this is latent — but any future
caller that omits it gets a private registry shared with no delegation pool, and routes and pool then
lock on different maps with no error. The same `??` fallback exists for `DelegationCancelRegistry`
(`app.ts:228`) and `PendingAskRegistry` (`:232`). Make the shared registries required options.

### Things I checked and found CORRECT (recorded so the lead does not re-spend budget)

- **The voice/global wall holds in every direction I could reach.** Search fences on `'global','voice'`
  (`packages/chat/src/repositories/chat-search.ts:75-76`); detail read forbidden scopes
  (`apps/local-api/src/routes/sessions/index.ts:251`); the self-read lift accepts both scopes
  (`apps/local-api/src/sessions/turn-session-header.ts:56-60`). `list_sessions` has **no** scope
  filter when unscoped (`routes/sessions/index.ts:118-135`) — but the voice chain is dropped upstream
  because every voice segment is `visibility: 'hidden'` and the tail's scope is not `'global'`
  (`packages/session/src/overview/fold-session-chains.ts:68-69`). And `send_message to:"session:<id>"`
  cannot reach it: `findRoutableSessionBySegmentId` accepts only `'spawned' | 'agent'`
  (`packages/session/src/spawned/find-spawned-session-by-segment.ts:45-51`).
- **Settings copy-forward on a swap is complete** — both writers copy all four settings columns *and*
  the status trio (`packages/chat/src/records/record-swap-segment-session.ts:102-112` and
  `packages/chat/src/turn-consumption/handle-session-started.ts:147-157`).
- **Restart safety is genuinely covered**: `reapOrphanedSessionTurns` + `reapAllStartedChatToolCalls`
  before any service starts (`boot.ts:288-306`), `expireAskRequests` (`:437`),
  `recoverStalePendingApprovals(reapAllPending: true)` (`:444`), `sweepOrphanedBackgroundProcesses`
  (`:195`), and the two delegation passes (`delegation-service.ts:117`, `:129`) with report deliveries
  *requeued* rather than failed. This is unusually thorough.
- **Retries are bounded**: `DELEGATION_MAX_ATTEMPTS = 3` with `[30, 300]s` backoff
  (`packages/session/src/delegation/classify-turn-failure.ts:13-17`).
- **The consume loop's teardown reap** cancels every still-`started` tool call in a `finally`
  (`consume-session-event-stream.ts:495-518`), and a client `.return()` on the generator triggers it.

---

## 2. Where a session can get STUCK while running

| # | Stuck point | How it happens | Recovery | Sev |
|---|---|---|---|---|
| S1 | **A wedged in-process run holds its target key forever** | `SessionTargetLocks` has no lease and its waiters have no timeout (`packages/session/src/delegation/session-target-locks.ts:28-35`). `delegation_jobs.claimedAt` is written at claim (`packages/orchestration/src/repositories/delegation-jobs.ts:193`) and read *only* for duration stats (`attach-delivered-run-stats.ts:109-110`) — there is **no expiry predicate anywhere**. | **Process restart only.** `failOrphanedClaimedDelegations` (`delegation-jobs.ts:553`) and `requeueOrphanedClaimedReportDeliveries` (`:584`) run at boot, never on an interval. In-process the only bound is the wall-clock budget — which (A1) releases the lock too *early* rather than too late. | P2 |
| S2 | **A queued turn parks with no bound** | `chat-turn.ts:488` / `session-turn.ts:263` `await locks.acquire(key)` has no timeout; a client that disconnects while parked does **not** cancel the waiter (deliberate — `session-turn.ts:446-457`), so it still runs to completion on release. | Only when the holder releases. Correct by design, but if S1 fires the workspace becomes permanently unwritable with no diagnostic. | P2 |
| S3 | **A second GLOBAL/VOICE turn looks frozen** | `run-global-root-turn-core.ts:94` parks the whole turn on `runUnderRootTurnLock`, but `streamGlobalRootTurn` emits `turn-queued` **only** when `isPrimarySwapping(...)` (`global-root-turn.ts:345-347`). No `isBusy` probe exists for the root lock, so an ordinary "another turn is running" park sends nothing. The workspace/DM streams both emit the sentinel for the `busy` reason (`chat-turn.ts:479-486`, `session-turn.ts:257-262`). | Resolves when the holder finishes; the composer looks dead meanwhile. Fix: expose `isLockKeyBusy(lockKey)` from `root-turn-lock.ts` and emit the same sentinel. **NEW** | P2 |
| S4 | **A voice turn's auto-continuations run unheard, holding the voice lock** | `streamGlobalRootTurn` never passes `autoContinue`, so `runTurnWithContinuations` defaults to `true` and the nudge is armed (`run-global-root-turn-core.ts:109`, `:231`). The daemon returns at the FIRST `session-completed` (`apps/voice/src/brain/run-brain-turn.ts:86-89`) and goes ACTIVE (`voice-session-driver.ts:279`). Up to 3 continuations then run on sonnet-5 while the daemon says "listening" and the next utterance parks on `${userId}:voice` with no sentinel (S3). | Self-heals after `MAX_CONSECUTIVE_CONTINUATIONS = 3`. Fix: pass `autoContinue: false` for voice turns — STATE.md records "voice auto-continue DEFERRED"; this is the code that makes the deferral untrue. **NEW** | P2 |
| S5 | **An approval on a card-less surface parks the turn for 60 s** | The approvals reaper interval is `RECOVERY_INTERVAL_MS = 60_000` (`apps/local-api/src/services/approvals-recovery-service.ts:15`). Any turn on a surface with no card renderer eats a full minute per carded tool. Reachable today on the **voice call leg** (A2) and on delivery turns. | Bounded at ~60 s, then denied with the timeout steer. P1 in combination with A2. | P2 |
| S6 | **A poisonous report delivery can re-queue without an attempt bound** | `requeueOrphanedClaimedReportDeliveries` sets `status: 'pending'` and deliberately does **not** bump `attemptCount` (`delegation-jobs.ts:578-598`). A delivery that crashes the process is re-claimed on every boot forever. | None — needs a crash loop to bite. **NEW, PLAUSIBLE** | P3 |
| S7 | **`chat-turn.ts` takes no lock at all when continue-mode is off** | `chat-turn.ts:475-478` `if (!isContinueActive) { await runTurn(stream); return }`. The justification is "non-primary turns target sessions the pool never writes". If a client ever passes `resumeSessionId` equal to the primary's `currentSdkSessionId`, that claim is false and there is zero exclusion. | Today the UI only sends `continueRoot` or a *listed* session id (`use-chat-turn.ts:186-191`), and every workspace-primary segment is hidden (`apply-primary-turn-continuity.ts:82-84` `hidesFirstSegment`), so it is not reachable from the app. **PLAUSIBLE** — worth a server-side guard (resolve the id; if it is a live primary's head, take that primary's key). | P3 |

**Not stuck, verified.** The root lock cannot wedge on a failed turn (`root-turn-lock.ts:27` runs
`turn` on *both* handlers); `swapping-primaries` clears in a `finally`
(`packages/session/src/continuity/bridge-primary-session.ts:112-113`); the cancel handle and the
activity handle both end in the tick's `finally` (`run-delegation-claim-and-run-tick.ts:874-876`);
ask waiters are cancelled + expired in every turn path's `finally` (`chat-turn.ts:431-448`,
`global-root-turn.ts:409-420`); `speakThroughDaemon` is bounded at 4 s
(`apps/local-api/src/routes/voice/speak-through-daemon.ts:9`) so a dead daemon cannot hang a turn.

---

## 3. Modes / models / effort binding + inheritance

Resolution is `input ?? row ?? surface-default` — `packages/chat/src/settings/resolve-turn-session-settings.ts:31-35`,
with the surface default deliberately left at the call site (`:1-6`). `DEFAULT_SESSION_MODE = 'ask'`
(`packages/session/src/session-mode.ts:77`).

| Path | mode | model | effort | auto-buildout | source of truth | verified by |
|---|---|---|---|---|---|---|
| Workspace chat (`streams/chat-turn.ts`) | `input ?? row ?? 'ask'` (`:112`,`:119`) | `input ?? row` (`:112`) | `input ?? row` | written, never read | `chat_sessions` + request | read |
| Workspace chat → children | header `x-vynel-delegation-mode`, stamped **only when a mode resolved** (`:175-178`) | `options.model` on the enqueue | ditto | n/a | `delegation_jobs.permissionMode` | read |
| Spawned/agent DM (`streams/session-turn.ts`) | `input ?? row ?? 'ask'` (`:94-95`) | `input ?? row` | `input ?? row` | written | row born **all NULL** | read |
| Global root web (`streams/global-root-turn.ts`) | `input ?? row`, else **undefined → core's `bypass-with-behavior-gate`** (`:160-161`, core `:202`) | `input ?? row`, then the voice fit clamp (`:182-195`) | `input ?? row` | written | `chat_sessions` | read |
| **VOICE turn (`/root/turn`, `voice:true`)** | never read, never written (`:150-154`, `:338-340`) → core default `bypass-with-behavior-gate` | raw input pin + `fitPinnedModelToSession` | raw input pin | never written | the daemon's pin (`packages/contracts/src/chat/voice-tier.ts:14-15`) | read |
| **VOICE CALL turn (`/sessions/:id/turn`)** | **`'ask'`** ⚠ | pin, **no fit guard** ⚠ | pin | **stamped onto the row** ⚠ | none of the three gates apply | **repro'd** |
| Spawned session at birth | NULL | NULL | NULL | NULL | `build-new-chat-session-row.ts:41-57` sets none | read |
| Agent-leaf at birth | NULL | NULL | NULL | NULL | `record-leaf-session.ts` | read |
| Swap segment | copied | copied (`selectedModel`) | copied | copied | predecessor row | read |
| Continuation turn (interactive) | inherits the segment's row | ditto | ditto | ditto | copy-forward | read |
| Checkpoint follow-up job | re-carried (`enqueue-checkpoint-continuation.ts:142-183`) | re-carried | re-carried | n/a | the job row | read |
| Delegation → workspace root | `claimed.permissionMode ?? 'bypass-with-behavior-gate'` (`delegate-to-workspace-root.ts:158`) | `claimed.model`, **no fit guard** | `claimed.thinkingEffort` | no column | `delegation_jobs` | read |
| Delegation → spawned / agent session | same | same | same | no column | ditto | read |
| **Agent-run job** | carried | `claimed.model ?? agent.model` | **always NULL** — `enqueue-agent-run.ts:101` hardcodes it ⚠ | — | — | read |
| **Leaf session** | **not carried at all** — `delegate-to-leaf-session.ts:62` passes model only ⚠ | carried | not carried | — | — | read |
| **Report / update delivery** | **all three hardcoded NULL** at enqueue (`enqueue-report-delivery.ts:107-109`, `enqueue-update-delivery.ts:112-114`) — the delivery turn runs the unattended default regardless of the user's mode | — | — | — | — | read |
| Note delivery | mode carried; model/effort NULL | — | — | — | — | read |
| Channels (`runGlobalRootTurn`) | deliberately untouched → unattended bypass default | — | — | — | STATE.md locked | read |

**Gaps, ranked.**

1. **`session-turn.ts` has no voice gate — A2.** Three defects on one path:
   (i) mode falls to `'ask'` on a hands-free call;
   (ii) `persistTurnSessionSettings` at `:283` is *unconditional*, so every call turn stamps
   `selectedModel='claude-sonnet-5'` / `thinkingEffort='low'` onto the call session — the "voice never
   writes settings" rule is enforced on one of the two voice legs only;
   (iii) no fit clamp.
   Full hop chain: `apps/voice/src/call/call-session-client.ts:19` creates the session via
   `POST /sessions/spawned` → `record-spawned-session-segment.ts` (via `build-new-chat-session-row.ts:41-57`)
   sets none of the four columns → `call-session-client.ts:32-37` posts
   `{ userMessageText, model, thinkingEffort }` with **no `mode`, no `voice`** →
   `session-turn.ts:94` `resolveTurnSessionSettings` → `mode: input.mode ?? row?.sessionMode ?? undefined`
   → `session-turn.ts:95` `toPermissionMode(undefined ?? DEFAULT_SESSION_MODE)` = `'ask'` →
   `packages/providers/src/claude/approvals/tool-approval-policy.ts:8-11` (ask cards the floor).
   Repro (throwaway vitest at `packages/chat/src/settings/`, run then deleted):
   `resolveTurnSessionSettings({ model:'claude-sonnet-5', thinkingEffort:'low' }, { sessionMode:null, selectedModel:null, thinkingEffort:null })`
   → `expect(resolved.mode).toBeUndefined()` — **1 passed**.
   Fix: add `voice?: boolean` to `StartSessionTurnRequestSchema`, send it from `call-session-client.ts`,
   and apply the global stream's three gates in `session-turn.ts`.
2. **Spawned/agent sessions are born with NULL settings** (KNOWN residual, still open). A DM into a
   child of an `auto` parent defaults to `ask`. `create-spawned-session.ts:88-94` has the creator's
   context in hand and could birth-stamp it. A2 is the sharp end of this.
3. **No fit guard on any delegated model pick** (A5, KNOWN residual — confirmed still real, and
   broader than recorded: it covers the agent's own configured model too).
4. **`autoBuildout` is written but never resolved** — absent from `TurnSettingsInput`
   (`resolve-turn-session-settings.ts:15-19`) and it has no `delegation_jobs` column. The schema is
   honest about it (`chat-sessions.ts:109-110`), but a composer chip that changes nothing is a
   user-visible lie.
5. **`enqueue-agent-run.ts:101` hardcodes `thinkingEffort: null`** while carrying mode and model — an
   agent run always runs at the adaptive default even when the parent picked `max`. Looks like an
   oversight rather than a decision (both siblings carry it).
6. **`delegate-to-leaf-session.ts:62` carries model only** — a leaf never inherits the parent's mode.
   Defensible (leaves keep the provider backstop) but undocumented as a decision.
7. **Delivery turns hardcode all three NULL.** Deliberate, but it means an `ask`-mode user's report
   delivery turn runs under `bypass-with-behavior-gate`. Worth a conscious re-confirmation.

---

## 4. Places we missed that can be improved

1. **Two process-wide registers are the continuity system's single point of amnesia.**
   `pending-checkpoints.ts:28-29,97` and `swapping-primaries.ts:10` are module-level singletons, both
   honestly documented as v1 in-process choices. The consequence worth naming: a restart between a
   `checkpoint()` call and its continuation silently drops the work with **no durable trace on the
   session** — the model said "I'll continue after patching context" and nothing ever does. The tool
   call is persisted but nothing reads it. Cheapest fix short of a migration: on `beginGenuineTurn`'s
   stale-drop (`run-turn-with-continuations.ts:32-39`) persist a one-line assistant note so the user
   sees why the thread stopped.
2. **`activityFeed.begin` never carries `primarySessionId` for global or voice turns**
   (`global-root-turn.ts:321-325`, and the channel runner). Every downstream reader is then forced to
   infer identity from `scopeKind` + a null session id — exactly what produced A3. Adding the field is
   ~1 line each and removes a whole class of guessing.
3. **`turn-queued` is a three-way inconsistency.** Workspace and DM streams emit it for both reasons;
   the global stream emits it for `context-patching` only; the voice daemon and the call loop don't
   handle it at all. One helper (`emitQueuedSentinelIfParked`) would settle it.
4. **The 600 s delegation budget is a magic number with two meanings** — "how long to wait" and (via
   A1) "how long the lock is held". Splitting those is the fix for A1 and makes the constant honest.
5. **No observability on the lock registry.** No route, no log on acquire/park. S1 is undiagnosable in
   production. `busyKeys()` already exists; exposing it on a diagnostics read is trivial.
6. **Testing gap: nothing asserts the lock outlives the turn.** Existing tests pin the *release*
   (`session-turn.test.ts`) but not "a timed-out run must not free the key" — that is the regression
   test A1's fix should ship with.
7. **`fitPinnedModelToSession` reads `segment.model`, the what-ran column** (`:63`), never
   `selectedModel`. Correct, but the two-model-column distinction (`chat-sessions.ts:78` vs `:106`) is
   subtle enough to deserve a named accessor rather than a raw field read at four sites.
8. **The `<synthetic>` fix is one-sided.** The translator drops usage from synthetic messages, but
   nothing prevents a future zero-usage path from writing `lastContextTokens: 0`
   (`handle-usage-reported.ts:59-62` writes unconditionally whenever `sessionId` is set). A guard —
   "never lower `lastContextTokens` to 0 within a turn" — would make the class impossible rather than
   patched at one source.

---

## 5. Monitoring binding + node display

**My interpretation: both readings, answered separately.**

### (a) The Nodes constellation view

**Binding is genuinely one-truth, and that is recent, deliberate work.**
`composables/nodes/node-status.ts:122-138` is a *pure rename* of the real ladder into the scene
palette; `use-fleet-nodes.ts:20-30` takes `useWorkspaceStatuses`; `use-project-nodes.ts:62-66` gives
"The build" the room's status and `:74-77` gives each session `deriveSessionStatus`. The file headers
record the bug this replaced (an invented `waiting` else-branch that could never reach `problem`).
Nothing is invented; `hasAnswered` gates "empty" against "loading" at both levels
(`use-fleet-nodes.ts:36-38`, `use-project-nodes.ts:84-88`). This is the healthiest binding in the app.

**Can it be enlarged easily? Partly — two levels come free, the rest does not.**

*What is ready.* `SceneNode` is a 4-field contract (`utils/constellation-scene.ts:20-27`) and the scene
is a plain rAF loop over mutable buffers, so *more nodes* costs nothing structurally; `displayNodes`
(`NodesView.vue:66-68`) is a single computed swap, so a third level is a new composable plus a
`drilledSessionId` ref.

*What is missing, concretely.*
1. **There is no node for the GLOBAL assistant or the VOICE thread — at any level.** The fleet level
   draws workspaces only (`useFleetNodes(overviewQuery.data.workspaces)`), and the project level
   filters `if (row.workspaceId !== workspaceId) continue` (`use-project-nodes.ts:69`), which also
   excludes every global-grounded spawned session. The two scopes the user cares most about are
   invisible. Voice is worse than invisible: it has no overview entry at all
   (`fold-session-chains.ts:68-69` drops a chain whose every segment is hidden and whose tail scope is
   not `'global'`), so there is no `statusFacts` row to bind even if a node existed.
2. **No level below a session.** Spawned children, agent runs and tasks have no node. The data mostly
   exists — `session_turns` carries `primarySessionId`/`jobId`/`threadId`
   (`session-activity-feed.ts:52-70`) and `delegation_jobs` carries `threadId` — but nothing composes a
   parent→child node tree. `recordDelegation` writes the tree edge
   (`delegate-to-leaf-session.ts:74-79`) and nothing on this screen reads it.
3. **Edges are a second, ad-hoc truth.** `use-message-edges.ts:157-164` polls
   `activity.listRecentMessages` every 8 s while the live channel already carries the whole activity
   feed over one socket. Its header (`:154-156`) justifies the poll as "a short-lived line does not
   justify a new event kind" — reasonable then, cheap to fold now that the hub exists.
4. **Per-node info is capped at the type.** `SceneNode` has no room for occupancy, turn elapsed, task
   label, or persona — all of which the overview entry and the feed frame already carry. Widening
   `SceneNode` is the single change that unlocks "more info per node".
5. **Two different reads for the two levels** — `useDashboardOverview` for the fleet,
   `useSessionsOverview` + a by-name `chat.getContinuing` for the project: three queries, three
   cadences, one screen.

**What I'd change (ordered).** (i) Widen `SceneNode` with an optional `detail` bag and an explicit
`kind` (`workspace | conversation | agent-run | task`) so every later level reuses one renderer.
(ii) Add a **global** pseudo-project node holding the Assistant + Voice + global-grounded spawned
sessions; this needs the voice thread to gain an overview entry (see (b)). (iii) Build the third level
from `session_turns.primarySessionId` + `delegation_jobs.threadId`, which already model the
parent→child relation. (iv) Fold `useMessageEdges` onto the live channel.

### (b) The wider live-monitoring binding

**One truth, with three named seams where it drifts.**

- The spine is sound: `SessionActivityFeed` is the single in-flight registry, mirrored durably into
  `session_turns` by `buildSessionTurnRecorder`, replayed on subscribe
  (`session-activity-feed.ts:213-222`), fanned by `LiveChannelHub` over one WS per window, folded into
  `activity-store.ts:88-110`. `deriveSessionStatus` is the only ladder and `resolveNodeStatus` is a
  pure rename of it. No double-derivation of *status* anywhere I found.
- **Drift 1 — voice is not covered.** A voice turn appears on the feed as `scopeKind: 'global'` with no
  primary id, which (i) mis-attributes it to the Assistant entry during the pre-resolution window (A3)
  and (ii) leaves the voice thread with **no** status light, **no** sessions-library row and **no**
  node, because it has no overview entry at all. The Voice chat panel works around this with two
  bespoke doors and its own poll signal (`VoiceChatPanel.vue:42-44, 51-58`) — a fourth private reader
  of liveness.
- **Drift 2 — `activity.end(turnOutcome)` and the continuation loop disagree on the terminal.**
  `chat-turn.ts:394` sets `turnOutcome = 'failed'` on the first non-recoverable `session-errored` and
  never resets, while `runOneTurn` (`run-turn-with-continuations.ts:212-221`) is
  **last-terminal-wins** — so a turn whose first pass errors non-recoverably and whose continuation
  completes records `'failed'` on the envelope while the loop treats it as completed. Narrow (needs a
  non-recoverable error followed by a completion in one stream) — **P3, PLAUSIBLE** — but it is a real
  disagreement between two homes about the same fact.
- **Drift 3 — three liveness readers with three predicates.** `activity-store.ts:26-35`
  (`hasGlobalServerTurn` / `globalServerTurnOrigin`, first-match), `use-session-statuses.ts:28-58`
  (`liveTurnStartedAtForEntry`), and `VoiceChatPanel.vue:42-44`. The arc's review fixed the third; the
  second is A3. One shared `matchTurnToIdentity(turn, entry)` helper would close the class.

---

## 6. Session continuity everywhere

| Runner | pressure → swap | carry | checkpoint / auto-continue | nudge | whoami / duty book |
|---|---|---|---|---|---|
| Global web (`streamGlobalRootTurn`) | ✅ `run-global-root-turn-core.ts:297` | ✅ | ✅ (`:103-111`) | ✅ (`:231-237`) | ✅ (`global-root-turn.ts:206`) |
| Global channels (`runGlobalRootTurn`) | ✅ same core | ✅ | ✅ | ✅ | ✅ |
| **VOICE turns** | ✅ same core; swap segments inherit scope (`handle-session-started.ts:130-134`) | ✅ | ⚠ **on, and it should not be** (S4) | ✅ | ✅ |
| Report / note delivery | ✅ | ✅ | ⛔ by design — `autoContinue: false` (`run-global-root-turn.ts:417`) | ⛔ (`core:231`) | ✅ |
| Workspace chat | ✅ `start-chat-turn.ts:250` via `continuity` (`chat-turn.ts:294`) | ✅ | ✅ `runContinuingTurn` | ✅ | ✅ |
| Spawned / agent DM | ✅ (`session-turn.ts:310`) | ✅ | ✅ | ✅ | ✅ |
| Delegation → workspace root | ✅ `delegate-to-workspace-root.ts:234` | ✅ | via `enqueueCheckpointContinuation` | ✅ | ✅ |
| Delegation → spawned | ✅ `:256` | ✅ | ✅ | ✅ `:184` | ✅ |
| Delegation → agent session | ✅ `:221` | ✅ | ✅ | ✅ `:167` | ✅ |
| Agent-run job | ✅ (delegates to `delegateToAgentSession`) | ✅ | ✅ | ✅ | ✅ |
| Leaf session | ⛔ correct — one-shot, no continuing identity | — | — | — | — |
| Monitor / schedule / task wakes | ✅ — they arrive as delivery or workspace turns and inherit those rows | ✅ | per kind | per kind | ✅ |

Coverage is **complete** — this is the arc's real achievement, and `withBoundaryContinuity` as a
stream wrapper is why a new runner cannot forget it.

**Where it can still break, ranked.**

1. **A1 breaks the ordering guarantee outright.** The whole design says "the swap runs inside the
   runner's lock, so it is ordered ahead of the identity's next turn"
   (`apply-primary-turn-continuity.ts:9-11`). A timed-out run's swap runs *outside* any lock,
   concurrently with the next turn. This is the single most damaging continuity break I found.
2. **Global + voice now run concurrently and share a cwd.** `resolveVoiceConversationTarget` returns
   `resolveGlobalRootWorkspacePath()` (`resolve-global-root-conversation.ts:62`) — the same hidden
   user-data dir as the global root, and the two locks are disjoint by design (`root-turn-lock.ts:93`).
   The *sessions* are separate so the DB side is clean, but any per-cwd CLI state (`.claude/` settings,
   todos) is now shared by two concurrent processes. I found no concrete corruption; flagging it as an
   unexamined consequence of the lock split.
3. **Restart amnesia** (§4.1): `pending-checkpoints` and `swapping-primaries` die with the process.
   `takeContinuationJob`'s own comment accepts it ("after a restart the follow-up simply runs as a
   genuine turn"), but the *interactive* checkpoint has no such fallback — it is simply lost.
4. **The voice no-write rule vs copy-forward is consistent** — I checked: a voice swap segment inherits
   `sessionMode`/`selectedModel` from its predecessor, which for a voice chain is NULL all the way down
   (nothing ever writes them), so the pins never leak into the row. **But the *call* leg violates it**
   (A2/iii): its spawned session *does* accumulate the pins.
5. **A fresh swap segment has `model = NULL`** (only `selectedModel` is copied) until its first usage
   report. `prepareTurnContinuity` then measures against `resolveContextWindow(null)` — harmless
   because `usedTokens` is 0 — but `fitPinnedModelToSession:63` reads the same NULL and falls to
   `undefined` (engine default). A chain-level fallback exists in `foldSessionChains:83-84` and is used
   by neither. Cheap improvement: have `fitPinnedModelToSession` walk the chain the way the fold does.
6. **The continuation cap is per-process and per-identity** (`MAX_CONSECUTIVE_CONTINUATIONS = 3`);
   `beginGenuineTurn` resets it, and a delegated follow-up job is registered in `continuationJobsById`
   so it counts (`pending-checkpoints.ts:97-109`) — good. After a restart it resets. Accepted.
7. **Transcript resolution across segments** reads the chain from the head; the fold's
   newest-child-wins rule (`fold-session-chains.ts:43-48`) handles a crashed double swap. Solid.

---

## 7. Overall score — **7.5 / 10**

| Dimension | Score | Why |
|---|---|---|
| Correctness | 7 | The persistence spine (`consumeSessionEventStream`, the co-committed session+message+outbox transaction, the swap-segment chaining, the teardown reap) is careful and defended by comments that name the bug each guard exists for. The failures I found are at the *edges between* runners (a timeout that frees a lock, a voice leg that skipped a stream's gates), not in the core. |
| Stuck-resistance | 6.5 | Restart recovery is excellent (six independent boot reaps). In-process it is thinner: no lease, no waiter timeout, no lock observability — and the one wall-clock bound is the thing that breaks single-writer. |
| Settings integrity | 6.5 | The `input ?? row ?? default` model is clean and copy-forward is complete. But three of four columns cross the delegation boundary and one does not; five paths carry a partial subset; the voice no-write rule is enforced on one of two legs; one column is written and never read. |
| Observability | 8 | One activity feed, one durable envelope, one live channel, one status ladder, a genuinely-fixed node screen. Docked for voice's absence from all of it and for three private liveness predicates. |
| Continuity | 8.5 | Complete coverage across every runner, made unforgettable by the stream-wrapper shape. Docked for process-wide registers and for A1 undoing the ordering guarantee. |
| Voice | 6 | The thread split is the right design and the wall is properly closed in every direction I could probe. But the newest surface is the least-gated: the call leg missed all three voice gates, `speak` has a dead branch, and auto-continue is on where the docs say it is deferred. |
| Tests | 8 | Real SQLite, colocated, and the tests pin *behaviour that regressed before* (the chain-scoped status read, the swap-segment scope inherit). Gap: nothing asserts lock lifetime. |
| Code health | 8.5 | Comments explain WHY at a standard I rarely see; the "one home" discipline is real. The two files past the size cap are flagged in their own headers. |

**What moves it up one point (to 8.5).** Fix A1 (hold the target lock until the delegate promise
settles, with a regression test); give `session-turn.ts` the voice gates (A2); stamp
`primarySessionId` on global/voice feed entries and fix A3's predicate; pass `autoContinue: false` for
voice; fix the dead `onSpeak` branch. All five are small, local, and each closes a class rather than
an instance.

**What moves it up three (to a genuine 10).**
(i) Make the exclusion domain *durable and observable* — a `claimedAt` lease with an interval reaper, a
waiter timeout, and a diagnostics read of held keys, so "a session is stuck" is a query rather than an
inference.
(ii) Make continuity survive a restart — `pending_checkpoints` as a table, which also lets the
delegated and interactive halves share one mechanism.
(iii) Make voice a first-class scope everywhere it is currently a special case: its own overview entry
(a `voice` scope filter rather than being dropped by the hidden-segment rule), its own feed identity,
one home for the three pins *and* the three gates, and one `matchTurnToIdentity` helper replacing the
three private liveness predicates.

---

## 8. VOICE SESSION review

### End-to-end trace (as built)

`detectWakeWord` (`voice-session-driver.ts:236`) → either handoff to the browser overlay (`:239-243`)
or `#runTurn` (`:253`) → `createBrainClient` POSTs `/root/turn` with
`{ model: VOICE_MODEL, thinkingEffort: VOICE_THINKING_EFFORT, voice: true }`
(`run-brain-turn.ts:100-107`) → `streamGlobalRootTurn` branches on `input.voice`
(`global-root-turn.ts:129-133`) → `resolveVoiceConversationTarget`
(`resolve-global-root-conversation.ts:51-64`, scope `'voice'`, **same cwd as global**) → settings read
and write both gated off (`:150-154`, `:338-340`) → fit clamp (`:182-195`) → `runGlobalRootTurnCore`
locks `${userId}:voice` (`run-global-root-turn-core.ts:93-94`), titles new segments
`'Voice conversation'` scope `'voice'` (`:279-282`), and **skips the catch-up block**
(`composeGlobalRootProviderMessage` gated on `input.voice`, `:181-188`) → the model answers by calling
`speak` (`routes/voice/index.ts:66-102`; 4 s bounded, `speak-through-daemon.ts:9`) → the daemon's
`onSpeak` four-party router (`apps/voice/src/main.ts:146-159`) → `driver.speak` queue → `LineSpeaker`.
The daemon ignores `text-chunk` entirely (`voice-session-driver.ts:269`) — the `speak` tool is the only
voice output. The web overlay leg runs the same server path with its own player and a no-`speak` gist
fallback (`voice-turn-adapter.ts:24-57`). The Voice chat panel reads two UI-only doors and sends real
voice turns (`VoiceChatPanel.vue:51-58, 73-78`).

**What is genuinely right.** The thread split is the correct fix for the 2026-08-19 incident. The wall
is closed in every direction I probed (see §1 "found correct"). The pins live in **one** home
(`packages/contracts/src/chat/voice-tier.ts:14-15`) consumed by four surfaces — the "three pins" the
brief asks about are already one home; it is the *gates*, not the pins, that are duplicated. The
catch-up skip is right and is properly keyed off `input.voice` rather than scope. `speak` is bounded at
4 s so a dead daemon cannot hang a turn.

### Where it breaks (ranked)

1. **A2 · P1 · the call leg has none of the three voice gates.** `session-turn.ts` contains no
   reference to `voice` at all. A call turn runs `ask` (cards nobody can see → 60 s dead air per tool,
   S5), stamps the pins onto the call session's row, and gets no fit clamp. The call client sends
   `model`/`thinkingEffort` but not `voice` (`call-session-client.ts:32-37`) — the fix is ~15 lines
   across the schema, the client and the stream.
2. **A4 · P2 · `onSpeak`'s handed-off branch is a no-op** (`main.ts:147-149`). Any non-overlay `speak`
   during an overlay session — the Voice chat panel's typed reply, a scheduled briefing, a delivery
   turn — is dropped and logged as played.
3. **S4 · P2 · voice auto-continue is ON.** `streamGlobalRootTurn` never passes `autoContinue`, so
   `run-global-root-turn-core.ts:109` defaults it true and `:231` arms the nudge, while the daemon
   returns at the first `session-completed` (`run-brain-turn.ts:86-89`). Continuations then run unheard,
   holding `${userId}:voice`, while the daemon says "listening" and the next utterance parks with no
   sentinel (S3). STATE.md records voice auto-continue as *deferred*; the code says otherwise.
4. **A3 · P2 · the voice turn mis-attributes to the global Assistant** during its pre-resolution
   window, masking a standing `problem` on the global thread.
5. **P2 · voice has no presence in any monitoring surface.** No overview entry
   (`fold-session-chains.ts:68-69` drops it), therefore no status light, no sessions-library row, no
   node. The Voice chat panel is the only window onto it, and it needed two bespoke doors and a private
   poll predicate to get there. Now that a "Voice chat" menu exists, the "invisible until a filter
   ships" justification has expired.

### Verdict on the recorded open forks

| Fork | My verdict |
|---|---|
| `direct_to_user` answers reach only the global catch-up net | **Right problem, wrong framing — and lower priority than A2/A4.** A voice-only user already cannot hear a *scheduled* or *typed-panel* reply whenever the overlay is handed off (A4), which is a strictly larger hole through the same surface. Fix A4 first; the direct-row absorption is then a small addition to the same router. |
| Voice-fired TASKS parent on the global conversation | **Correct as-is; do not re-plumb yet.** Kafi's "voice shows under global" makes the global thread the coherent work ledger, and re-parenting needs `resolveTaskSender` to grow a voice branch plus a voice-side delivery rail — real cost for no user-visible gain while voice has no sessions-panel presence at all. Revisit *after* voice gains an overview entry. |
| Split the voice doors out of `routes/root/index.ts` (503 lines) | **Do it, but it is a P3 chore, not a next move.** Legibility only. Ranked below every finding above. |
| Per-call sessions gain the routing toolset | **Do NOT do this next — fix A2 first.** Giving a call session the routing/mutating toolset while it runs in `ask` mode on a card-less surface makes S5 dramatically worse: every carding routing tool would stall a live call for 60 s. The mode gate is a prerequisite, not a follow-up. |

### My ranked improvements for voice

1. Voice-gate `session-turn.ts` (A2) — mode, no-write, fit clamp. Prerequisite for the call arc.
2. Fix `onSpeak`'s handed-off branch (A4).
3. `autoContinue: false` for voice turns (S4).
4. Stamp `primarySessionId` on the voice/global feed entry and fix `liveTurnStartedAtForEntry` (A3).
5. Give the voice chain an overview entry (a `scope: 'voice'` exemption in `foldSessionChains`, the
   same shape the global brain already has at `:69`), then a status light and a node.
6. Then, and only then, the routing toolset for per-call sessions.

---

## Top 10 ranked

| # | ID | Sev | Title | Where | Conf |
|---|---|---|---|---|---|
| 1 | A1 | P1 | Delegation wait-timeout frees the target lock while the turn keeps writing → two writers on one CLI session | `run-delegation-claim-and-run-tick.ts:818-824` + `delegation-service.ts:204-215` | CONFIRMED |
| 2 | A2 | P1 | Voice CALL turns run in ASK mode (cards nobody can answer) and stamp the pins onto the row — `session-turn.ts` has no voice gate | `apps/voice/src/call/call-session-client.ts:32-37` → `streams/session-turn.ts:94-95,283` | CONFIRMED (repro) |
| 3 | S4 | P2 | Voice auto-continue is ON; the daemon leaves at the first `session-completed` → continuations run unheard holding the voice lock | `global-root-turn.ts` (no `autoContinue`) + `run-brain-turn.ts:86-89` | CONFIRMED |
| 4 | A4 | P2 | `onSpeak`'s handed-off branch is a no-op — panel/scheduled/delivery speech is dropped and logged as played | `apps/voice/src/main.ts:147-149` | CONFIRMED |
| 5 | A3 | P2 | A voice turn's pre-resolution window lights the global Assistant "running" and masks its `problem` | `use-session-statuses.ts:51-56` | CONFIRMED |
| 6 | A5 | P2 | No fit guard on any delegated model pick (incl. an agent's own configured model) | one call site only: `global-root-turn.ts:183` | gap CONFIRMED / exploit PLAUSIBLE (KNOWN) |
| 7 | — | P2 | Voice has no overview entry → no status, no library row, no node, anywhere | `fold-session-chains.ts:68-69` | CONFIRMED |
| 8 | S1 | P2 | No lease/expiry on claimed jobs and no waiter timeout — a wedged run makes a target unwritable until restart, undiagnosably | `delegation-jobs.ts` (no expiry) + `session-target-locks.ts:28-35` | CONFIRMED |
| 9 | S3 | P2 | The global/voice stream emits no `turn-queued` for an ordinary busy park → the composer looks frozen | `global-root-turn.ts:345-347` vs `chat-turn.ts:479-486` | CONFIRMED |
| 10 | — | P3 | Settings carry is partial on five paths (agent-run effort, leaf mode, delivery all-three, `autoBuildout` unread) | see §3 table | CONFIRMED |

## Score

**7.5 / 10.** A well-designed, unusually well-reasoned session system whose core persistence and
continuity machinery is stronger than most production codebases — and whose real defects live at the
seams between runners and on the newest surface. Nothing I found is architectural; every top finding
is a local fix that closes a class.
