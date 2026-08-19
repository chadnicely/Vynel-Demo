# Session system audit — five-agent synthesis (2026-08-19)

Worktree `feature/session-audit` @ `06781328` (main + the voice-session arc + customization-to-DB).
Five independent Opus agents ran the **identical eight-question brief** from five different entry
points (interactive streams · global+voice · delegation engine · continuity+settings · monitoring UI),
each writing a full report (`agent-1.md` … `agent-5.md` in this folder). The lead re-verified every
P1 below by reading the cited code in this checkout; three findings were additionally reproduced by
throwaway vitests (deleted after). Docs were treated as claims; code won.

**Legend.** `P1` blocker/major · `P2` minor · `P3` nit/latent. `×N` = how many of the five agents
found it independently. `KNOWN` = already recorded in `.claude/STATE.md` (verified + ranked here).
Every path is worktree-relative.

---

## Verdict — 7 / 10

Agents scored 7.5 · 6.5 · 7 · 7 · 6. The spread is about weighting (how hard to punish the
unbounded waits and the voice envelope), not disagreement on facts — the P1 lists overlap almost
entirely.

**The core is strong.** The persistence spine (`consumeSessionEventStream`, co-committed
session + message + outbox, chain-scoped status facts), restart recovery (six independent boot
reaps), continuity coverage (every runner that has a continuing identity is wrapped by
`withBoundaryContinuity` — 5 `consumeSessionEventStream` sites ↔ 5 wrappers, 1:1), the live channel
(one socket per window, one status ladder) and code health (WHY-comments that carry their incident
dates) all rated 8–9 across the board.

**The defects live at the seams**, and every P1 is a local fix that closes a class:

- the **delegation lock is released while the routed turn is still writing** (timeout ≠ cancel);
- **card-less surfaces (voice wake, voice call, channels, delivery turns) inherit unbounded human-waits** —
  a floor tool or an `ask_user` parks the turn ~10 min or forever, holding the identity's lock, and the
  voice daemon has no deadline of its own;
- the **voice thread's operational envelope was not finished**: the CALL leg runs in `ask` mode, Stop
  reaches the *global* thread, voice impersonates the global primary on the activity feed, and voice
  has no status anywhere;
- the **catch-up net is consumed before the turn starts**, so a startup failure silently loses failure
  notices and `direct_to_user` answers;
- the **model-fit guard has exactly one caller** (voice) — the 2026-08-19 crash class is still open on
  every delegated runner.

+1 point = the Tier-A list below (all small, all local). +3 = Tier C: leases + bounded waits + a real
per-turn wall clock, durable checkpoints, `'voice'` as a first-class feed scope, and seam tests.

---

## Independent convergence (what several agents found separately)

| Finding | Sev | ×N | Reproduced | Lead-verified |
|---|---|---|---|---|
| Delegation timeout releases the target lock under a live turn | P1 | ×4 | agent 3 (vitest: two live turns on one workspace root) | ✅ |
| Voice turn announces as `scopeKind:'global'` with no `primarySessionId` → Global chat binds/renders the voice thread; Assistant row falsely `running` | P1 | ×5 | agents 3, 5 (vitest) | ✅ |
| Voice CALL leg runs its per-call session in `ask` mode | P1 | ×5 | agent 1 (vitest on `resolveTurnSessionSettings`) | ✅ |
| Voice chain never enters the overview → no status / row / node; a *failed* voice turn shows `problem` nowhere (a *parked* one is rescued only via the null-workspace approval → `attention.global`, attributed to Global) | P1 | ×5 | — | ✅ |
| Unbounded approval / `ask_user` waits on card-less surfaces (voice, channels, delivery) | P1 | ×3 | — | ✅ |
| Fit guard wired at ONE call site (voice) — delegated small-model picks unguarded (KNOWN) | P1 | ×5 | — | ✅ |
| No lease on claimed jobs · unbounded `SessionTargetLocks.acquire` · root lock has no deadline · no per-turn wall clock on interactive paths | P2 | ×4 | — | ✅ |
| Global/voice stream never emits `turn-queued{busy}` → composer looks frozen | P2 | ×2 | — | ✅ |
| Voice auto-continue ON while the daemon leaves at the first `session-completed` | P2 | ×2 | — | ✅ |
| Voice typed vs spoken = two modes/two models on one thread; panel chips PATCH a row voice never reads | P2 | ×3 | — | ✅ |
| Spawned / agent / leaf sessions born with NULL settings (KNOWN) | P2 | ×5 | — | ✅ |
| Agent-run jobs never carry thinking effort (`enqueueAgentRun` hardcodes null; @agent mentions drop it; checkpoint follow-up agent-run branch drops effort + origin) | P2 | ×4 | — | ✅ |
| `autoBuildout` persisted, copied forward, served — read by no runner (deliberate placeholder per `ui-store.ts:121`) | P2 | ×4 | — | ✅ |
| Process-wide registers (`pending-checkpoints`, `swapping-primaries`) die with the process → an interactive checkpoint is silently lost | P2 | ×5 | — | ✅ |
| Nodes: project level reads the unscoped 50-cap overview and filters client-side → busy account loses project nodes | P2 | ×3 | — | ✅ |
| Nodes: 4-field `SceneNode`, stringly ids, boolean levels → not enlargeable | P2 | ×4 | — | ✅ |
| Voice + global share one cwd for concurrent seeded swaps (unexamined; no corruption found) | P3 | ×3 | — | — |

Single-agent findings that the lead verified in code and promotes: **catch-up reports marked surfaced
before `startChatSession`** (agent 4, reproduced) · **Voice-panel Stop interrupts the GLOBAL session**
(agent 2) · **`onSpeak`'s handed-off branch is a no-op** (agent 1) · **restart destroys claimed `note` /
`direct-delivery` rows** (agent 4) · **fleet dots paint confident grey before the poll answers** (agent 4)
· **mode inversion / default asymmetry** (agents 3, 5).

---

## The fix list

### Tier A — fix now (each ≤ ½ day, closes a class; ships with a regression test)

1. **Delegation lock lifetime follows the delegate promise, not the tick.** On the 600 s budget
   `routeRequest` returns `timed-out` (`packages/orchestration/src/routing/route-request.ts:17-20,138` —
   "stop WAITING, not stop the target"), the tick fails the job and returns
   (`packages/session/src/delegation/run-delegation-claim-and-run-tick.ts:812-833`), and the pool's
   `.finally` releases the target key (`apps/local-api/src/services/delegation-service.ts:204-225`) while
   the routed turn is still inside `delegateToWorkspaceRoot`. The next claim (or a user continue-turn at
   `streams/chat-turn.ts:488`) resumes the **same** `currentSdkSessionId` → two writers on one CLI
   session; the zombie's later boundary swap repoints the primary under the successor; the orphan has no
   feed handle and Stop answers `already-finished`. Fix: release the key in the delegate promise's own
   `finally` (hand `delegationPromise` back with the envelope), or trip an abort/interrupt on timeout via
   the cancel registry. Test: "a timed-out run must not free its key".
2. **Voice CALL leg gets the three voice gates.** `apps/voice/src/call/call-session-client.ts:32-37` posts
   `{userMessageText, model, thinkingEffort}` — no `mode`, no `voice` — onto a spawned row born NULL
   (`packages/chat/src/turn-consumption/build-new-chat-session-row.ts:39-57`), so
   `streams/session-turn.ts:94-95` resolves `DEFAULT_SESSION_MODE = 'ask'` (`session-mode.ts:77`): a floor
   tool cards a live call for ~10 min; the pins are persisted onto the row (`:283`); no fit clamp. Fix:
   a voice-tier mode beside the pins in `packages/contracts/src/chat/voice-tier.ts`, `voice?: boolean` on
   `StartSessionTurnRequestSchema`, and `session-turn.ts` applies no-read / no-write / fit exactly like
   `global-root-turn.ts:150-195`. **Prerequisite for the per-call routing toolset.**
3. **Feed identity: stamp `primarySessionId` on the voice/global `activityFeed.begin`.**
   `streams/global-root-turn.ts:321-325` announces `{scopeKind:'global', origin:'voice'}` with no primary
   id; `stores/activity-store.ts:61-77` (`runningPrimarySessionIdFor`) and
   `composables/sessions/use-session-statuses.ts:51-56` (whose comment "every OTHER global-scope turn …
   always carries its session id" is now false) both infer identity from that absence →
   `use-continuing-conversation.ts:66-71` binds the Global chat to the voice segment (sticky for a
   voice-first user; `use-session-detail.ts:65-69` then renders it — the client-side hole in the wall);
   the Assistant row reads `running` (masking a standing `problem`); `hasGlobalServerTurn` /
   `globalServerTurnOrigin` are first-match reads over a map that can now hold both. Also fix
   `use-session-statuses` to require `primarySessionId === null` (which also closes the
   spawned-delegation over-claim: `run-delegation-claim-and-run-tick.ts:318-332` passes `primarySessionId`
   but no `sessionId`). Longer term: `'voice'` in the feed's `scopeKind` (a migration on
   `session_turns.scopeKind`).
4. **Card-less surfaces stop parking unbounded.** Voice wake, voice call, channels and delivery turns run
   `bypass-with-behavior-gate` which still cards the floor (`tool-approval-policy.ts:109-111`;
   Bash/Write/Edit/NotebookEdit); the card is an unbounded `await` (`build-claude-can-use-tool-callback.ts:69-90`,
   `pending-approval-registry.ts` has no timeout) reaped only at `requestedAt + 2×5 min` by a 60 s
   sweeper (`recover-stale-pending-approvals.ts:59-68`, `approvals-recovery-service.ts:15`). The daemon
   sits `busy`, drops mic audio (`voice-session-driver.ts:112,250-276`) and `streamTurnEvents` has no
   deadline (`run-brain-turn.ts:60-92`). Fix: the pattern already exists — routed leaves **fail closed**
   (`packages/orchestration/src/leaf/drain-leaf-turn.ts:15,84`); give card-less turns a deny-with-reason
   (spoken on voice) or a short bounded timeout, and add a daemon turn budget + `AbortController` +
   busy-watchdog. `speakThroughDaemon` is already bounded at 4 s — copy that discipline.
5. **`ask_user` bounded on the voice leg + a periodic ask reaper.** `global-root-turn.ts:209-219` leaves
   `ask_user` UNBOUNDED ("the user is present") and the voice turn goes through this exact function; the
   channel runner already bounds it (`sessions/run-global-root-turn.ts:56,272`,
   `CHANNEL_ASK_TIMEOUT_MS`); asks are expired only at boot (`boot.ts:422`) — approvals have a reaper,
   asks do not. On the global thread one parked ask wedges the whole `${userId}` root-turn lock
   (`root-turn-lock.ts:24-33`, no deadline): channels stall, global report deliveries burn their 600 s
   queued and settle `failed` (`run-report-delivery-tick.ts:430-437`) — excluded from every recovery net
   (`delegation-jobs.ts:383-472`).
6. **Mark catch-up reports surfaced only once the turn is underway.**
   `runtime/compose-global-root-provider-message.ts:54-56` calls `markDelegationsSurfacedToRoot` before
   `provider.startChatSession` (`run-global-root-turn-core.ts:181` vs `:195`); `surfacedToRootAt` is a
   one-way latch and this collector is the ONLY channel by which the root learns a task failed / a
   colleague finished silently / a `direct_to_user` answer landed. Engine unreachable or model rejected →
   reports gone forever (agent 4 reproduced it). Fix: mark from the consumer's `session-started` /
   `user-message-persisted` seam.
7. **Identity-shaped interrupt.** `use-chat-turn.ts:300-315` sends `root.interruptTurn()` for any
   `scope.kind === 'global'`; `routes/root/index.ts:496-501` resolves the **global** primary
   (`findPrimaryConversation` without a workspace = scope `'global'`). Voice-panel Stop therefore
   interrupts the global session (which can be running concurrently since the lock split) and leaves the
   voice turn running. Fix: `POST /root/turn/interrupt` takes an optional owner-checked `sessionId`
   (global-or-voice chain); the panel passes its head.
8. **Give the voice chain a status.** `overview/fold-session-chains.ts:68-69` drops any all-hidden chain
   whose tail is not `'global'`; voice segments are born hidden + scope `'voice'`
   (`run-global-root-turn-core.ts:279-282`) → no `statusFacts`, no `deriveSessionStatus`: a *failed*
   voice turn lights `problem` nowhere, a *parked* one is rescued only because the approval row's null
   workspaceId trips `attention.global` (attributed to Global, not Voice — the ONE-STATUS rule is
   unimplementable for voice as a scope), no Sessions row, no node; the Voice-chat panel needed two
   bespoke doors + a private poll predicate. Fix: a `voice`
   exemption in the fold **plus** `scope !== 'voice'` filters on the three unscoped-overview consumers
   (`LiveSessionPane.vue:21`, `TasksPanel.vue:120`, `SessionThreadView.vue:61`) — or a dedicated status
   read behind `GET /root/voice-chat/continuing`.
9. **Fit guard on every delegated model pick.** `fitPinnedModelToSession` has one caller
   (`global-root-turn.ts:183`, `isVoiceTurn`-gated); `delegate-to-{workspace-root,spawned-session,agent-session}.ts`
   (`:163`, `:174`, `:157`), `run-agent-run-job.ts:270-276` (`claimed.model ?? agent.model` — an agent's own
   configured model is never fit-checked) and `session-turn.ts` pass the pick straight through. Note
   `chat_sessions.model` (last-ran) is also the pressure denominator
   (`apply-primary-turn-continuity.ts:124-131`) — a small-model delegated turn rewrites it (candidate:
   `lastContextWindow`).
10. **Voice: `autoContinue:false` (or teach the daemon to stay for continuations) + fix the dead
    `onSpeak` branch.** `streamGlobalRootTurn` never passes `autoContinue` → the core defaults it on
    (`run-global-root-turn-core.ts:109,231`) while `run-brain-turn.ts:86-89` returns at the first
    `completed` → up to 3 continuations run unheard holding `${userId}:voice` while the daemon says
    "listening" (STATE.md records voice auto-continue as *deferred*; the code says otherwise).
    `apps/voice/src/main.ts:147-149` — the `isHandedOff` branch only logs, so a Voice-chat-panel typed
    reply, a schedule or a delivery turn's `speak` is dropped and logged as played during any overlay
    conversation. Route by producer.

### Tier B — decisions for Kafi / Chad (each is a design call, not a bug)

- **Voice typed vs spoken settings.** `docs/module-notes/voice-session.md:106-107` says the split is
  intended; STATE.md's locked semantics say "VOICE turns neither read nor write settings". Today the
  panel's composer PATCHes the voice row (`VoiceChatPanel.vue:198-203` → `use-session-settings.ts`), the
  panel passes no `mode` default so a typed voice turn can run `ask` (`ui-store.ts:97-102`), spoken turns
  ignore the row entirely, and the fit clamp silently overrides a *human's* typed model pick
  (`global-root-turn.ts:182`). Recommendation: one voice policy — pins + unattended mode with the
  card-less policy (Tier A-4); panel chips read-only "hands-free" or local-only.
- **Mode defaults.** (a) A mode-less interactive turn runs `ask` but stamps no `x-vynel-delegation-mode`
  (`chat-turn.ts:119,176-177`, `session-turn.ts:90,104-107`), so its children run
  `bypass-with-behavior-gate` — parent stricter than child (reachable from any non-web caller: CLI, MCP,
  the call leg). (b) A brand-new **global** thread resolves `bypass-with-behavior-gate`
  (`run-global-root-turn-core.ts:202`) while a new workspace/DM thread resolves `ask` — the widest
  toolset starts least-carding, undocumented. Recommendation: stamp the RESOLVED mode always
  (parent == child) and write the global default down beside `DEFAULT_SESSION_MODE`.
- **Birth-stamp spawned / agent / leaf sessions** with the creator's resolved settings
  (`create-spawned-session.ts:88-94`, `record-spawned-session-segment.ts:60-72`, `record-leaf-session.ts:49-66`
  write none) — closes the KNOWN "DM to a child of an auto parent defaults to ask" and is the root of the
  call-leg bug.
- **Delivery turns hardcode mode/model/effort NULL** (`enqueue-report-delivery.ts:107-109`,
  `enqueue-update-delivery.ts:112-114`) → an `ask`-mode user's report delivery runs unattended. Deliberate;
  re-confirm consciously.
- **Restart policy for `note` / `direct-delivery` rows.** `failOrphanedClaimedDelegations`
  (`delegation-jobs.ts:553-571`) fails and marks-surfaced everything but `report-delivery`; a `note`
  (the voice→global rail) or a `direct-delivery` (a final answer to the user) claimed at crash time is
  destroyed silently. Requeue them like reports?
- **`autoBuildout`**: a live composer toggle nothing reads (`ui-store.ts:121` "NOTHING READS IT YET"). Wire
  it, or disable/tooltip it until then.
- **Durable pending checkpoints** (a nullable `pending_next_step` + depth on `primary_sessions`, or a
  table) vs the accepted v1 in-process registers. With auto-continue shipped, a restart between
  `checkpoint()` and its continuation is "Vynel stopped mid-task and said nothing".
- **Continuation settings**: runs under the row's CURRENT settings (shipped default) or pins the
  checkpointing turn's — still open (recorded).

### Tier C — the robustness arc (what moves the score to 9–10)

- **Bounds everywhere.** `claimedAt` read as a lease + a periodic sweeper (today: boot-only
  `failOrphanedClaimedDelegations`); a bounded `SessionTargetLocks.acquire` (today: uncancellable
  `await`, `session-target-locks.ts:28-35`); a per-turn wall clock as an `AbortSignal` into
  `startChatSession`, suspended while an approval is parked (`ApprovalWaitGate` already models this);
  `isRootTurnLockBusy` + `turn-queued{busy}` on the global stream (`global-root-turn.ts:345-347` vs
  `chat-turn.ts:479-486`); a diagnostics read of held keys (`busyKeys()` exists); WARN on every park.
- **Delivery rail.** A parked approval suspends the budget on the workspace branch but not the global
  one (`run-report-delivery-tick.ts` global branch never marks its `waitGate`); a global delivery burns a
  pool slot while queued on the root lock; a timed-out delivery is terminal, not recoverable
  (`:430-437` vs `:446`); a recoverable notify-turn retry can append the same report twice (no
  idempotency key on the inbound row — the direct-reply path already has one).
- **Feed vocabulary.** `'voice'` as a first-class `scopeKind` (contracts + `session_turns` migration),
  `primarySessionId` on every `begin`, one `matchTurnToIdentity` helper replacing three private
  liveness predicates (`activity-store`, `use-session-statuses`, `VoiceChatPanel`).
- **Nodes.** Scoped project read (bug) · wire `hasAnswered` at the fleet level (`use-fleet-nodes.ts:36`
  built, `NodesView.vue:101` never uses it — dots paint confident grey during the poll flight) · id-keyed
  scene buffers (`constellation-scene.ts:760-766` reassign dots on reorder) · count-aware layouts (the
  orbit lane factor is index-linear, `:224` — nodes leave the stage from ~the 9th) · a `SceneNodeRef` discriminated union + a level stack
  replacing prefixed strings + the boolean `isInsideProject` · `SceneNode.detail` · Global + Voice nodes ·
  a third level from `session_turns.primarySessionId` + `delegation_jobs.threadId` · edges folded onto
  the live channel · `NodesRace.vue:24` two-state label · arcs mapping the whole segment set.
- **Settings.** `thinkingEffort` on `EnqueueAgentRunInput` (+ the @agent mention branch + the checkpoint
  follow-up agent-run branch which also drops origin); a `buildDelegationJobRow` helper so an omitted
  column is a type error (five duplicated ~30-field literals today); leaf mode carry documented.
- **Tests at the seams.** Lock-lifetime invariant · continuity census (5 ↔ 5) · call-leg mode ·
  catch-up not consumed by a failed turn · voice not interruptible by the global route · voice
  presence/absence in the overview.
- **Hygiene.** Split `routes/root/index.ts` (503 lines; the two `/voice-chat/*` doors are the only
  owner-scoped no-`x-mcp` routes in a file of tool-exposed ones) · split the 911-line tick at the kind
  branch · fix stale load-bearing comments (`use-session-statuses.ts:49-50`,
  `build-claude-can-use-tool-callback.ts:21-23`, `constellation-scene.ts:31`, `constellation-layout.ts:34-36`)
  · `mapFrameToBrainEvent` reports a recoverable `session-errored` as failed (`run-brain-turn.ts:37-42`)
  · `/activity/running` "rebuild seed" has no consumer (`routes/activity/index.ts:85-114`).

---

## 1. Bugs — consolidated

### P1

| ID | Scope | Finding | Where | ×N |
|---|---|---|---|---|
| L1 | workspace · spawned · agent | Delegation timeout releases the target lock under a live turn → two writers on one CLI session; orphan turn invisible + un-stoppable; its later swap repoints the primary | `run-delegation-claim-and-run-tick.ts:812-833` · `delegation-service.ts:204-225` · `route-request.ts:17-20,138` | ×4 (repro) |
| V1 | voice (call) · spawned | Per-call session runs `ask` — the widest card set — on a live call with no card surface; pins persisted onto the row; no fit clamp | `call-session-client.ts:32-37` → `session-turn.ts:94-95,283` | ×5 (repro) |
| V2 | voice · global · monitoring | Voice turn announces as global with no `primarySessionId` → Global chat binds/renders the voice thread (sticky for a voice-first user); Assistant row false `running`; first-match origin reads | `global-root-turn.ts:321-325` · `activity-store.ts:61-77` · `use-continuing-conversation.ts:66-71` · `use-session-statuses.ts:51-56` | ×5 (repro ×2) |
| V3 | voice · monitoring | Voice chain never enters the overview → no status / row / node; a failed voice turn shows `problem` nowhere | `fold-session-chains.ts:68-69` · `run-global-root-turn-core.ts:279-282` | ×5 |
| W1 | voice · channels · delivery | Card-less surfaces inherit an unbounded approval park (~10 min via the reaper) and an unbounded `ask_user` (forever; no periodic reaper); the daemon has no deadline and goes deaf | `tool-approval-policy.ts:109-111` · `build-claude-can-use-tool-callback.ts:69-90` · `recover-stale-pending-approvals.ts:59-68` · `global-root-turn.ts:209-219` · `boot.ts:422` · `voice-session-driver.ts:112,250-276` · `run-brain-turn.ts:60-92` | ×3 |
| G1 | global · channels · delivery | One parked ask/approval on the interactive global turn wedges the `${userId}` root lock; channels stall; global report deliveries time out `failed` and drop out of every recovery net | `root-turn-lock.ts:24-33` · `run-report-delivery-tick.ts:430-437` · `delegation-jobs.ts:383-472` | ×2 |
| G2 | global | Catch-up reports marked surfaced BEFORE `startChatSession` → a startup failure loses failure notices / `direct_to_user` answers forever | `compose-global-root-provider-message.ts:54-56` · `run-global-root-turn-core.ts:181,195` | ×1 (repro) |
| V4 | voice · global | Voice-panel Stop → `root.interruptTurn` → interrupts the GLOBAL primary (can kill a concurrent global turn); voice turn runs on | `use-chat-turn.ts:300-315` · `routes/root/index.ts:496-501` | ×1 |
| M1 | all delegated | Fit guard has one caller (voice); delegated / agent-run / DM model picks unguarded (KNOWN residual, confirmed reachable) | `global-root-turn.ts:183` (only site) · `delegate-to-*.ts` · `run-agent-run-job.ts:270-276` | ×5 |

### P2

| ID | Scope | Finding | Where | ×N |
|---|---|---|---|---|
| S1 | all | No lease on claimed jobs; `acquire()` unbounded; root lock no deadline; interactive paths have no wall clock; no lock observability | `delegation-jobs.ts:193` · `session-target-locks.ts:28-35` · `root-turn-lock.ts:24-33` | ×4 |
| S2 | global · voice | No `turn-queued{busy}` on the global/voice stream — a queued send looks frozen | `global-root-turn.ts:345-347` vs `chat-turn.ts:479-486` | ×2 |
| V5 | voice | Auto-continue ON while the daemon leaves at the first `completed` → continuations run unheard holding the voice lock; daemon state desyncs | `run-global-root-turn-core.ts:109,231` · `run-brain-turn.ts:86-89` | ×2 |
| V6 | voice | `onSpeak` handed-off branch is a no-op — panel / scheduled / delivery speech dropped, logged as played | `apps/voice/src/main.ts:147-149` | ×1 |
| V7 | voice | Two modes / two models on one thread (typed vs spoken); panel chips PATCH a row voice never reads; panel passes no `mode` default; fit clamp overrides a human pick silently; @mention dispatches built from the unfitted model | `VoiceChatPanel.vue:198-203` · `use-session-settings.ts:91-98` · `global-root-turn.ts:150-155,182,248` | ×3 |
| D1 | delivery | Global-branch delivery budget not suspended by a parked approval (workspace branch is); timed-out delivery terminal not recoverable; recoverable retry can double-deliver; global delivery burns a pool slot while queued on the root lock | `run-report-delivery-tick.ts` global branch, `:430-452` · `build-routed-approval-handler.ts:65-68` | ×3 |
| D2 | orchestration · voice | Restart destroys claimed `note` and `direct-delivery` rows (only `report-delivery` requeues) | `delegation-jobs.ts:553-571` | ×1 |
| C1 | continuity | Process-wide `pending-checkpoints` / `swapping-primaries` → an interactive checkpoint is silently lost on restart | `pending-checkpoints.ts:28-29,97` · `swapping-primaries.ts:10` | ×5 |
| T1 | settings | Mode inversion (mode-less parent `ask`, children bypass) + global-vs-workspace default asymmetry, undocumented | `chat-turn.ts:119,176-177` · `session-turn.ts:90,104-107` · `run-global-root-turn-core.ts:202` | ×2 |
| T2 | settings | Spawned / agent / leaf sessions born NULL (KNOWN) | `create-spawned-session.ts:88-94` · `record-leaf-session.ts:49-66` | ×5 |
| T3 | settings | Agent-run effort never carried; checkpoint follow-up agent-run branch drops effort + origin; leaf carries model only | `enqueue-agent-run.ts:99-101` · `composer-mention-turn.ts:190-194` vs `:215-219` · `enqueue-checkpoint-continuation.ts:159-168` · `delegate-to-leaf-session.ts:62` | ×4 |
| T4 | settings | `autoBuildout` read by no runner | `resolve-turn-session-settings.ts:31-35` · `ui-store.ts:121` | ×4 |
| N1 | nodes | Project level reads the unscoped 50-cap overview and filters client-side → missing session dots on a busy account (`LiveSessionPane` silently view-only too) | `use-project-nodes.ts:24,68-69` · `get-sessions-overview.ts:40` vs `use-sessions-library.ts:16-18` | ×3 |
| N2 | nodes | Fleet dots paint confident grey / "N idle" before the poll answers — `hasAnswered` built, never wired at the fleet level | `use-fleet-nodes.ts:36` vs `NodesView.vue:101` | ×1 |
| N3 | nodes | Index-keyed scratch buffers reassign dots on reorder; index-linear layouts with no level-of-detail (orbit lanes leave a 1600×900 stage from ~the 9th node); `NodesRace` two-state label; arcs drop pre-swap segments | `constellation-scene.ts:224,760-766` · `NodesRace.vue:24` · `message-scene-mapping.ts:60-65` | ×2 |
| N4 | nodes | Not enlargeable: 4-field `SceneNode`, prefixed-string ids parsed in three places, boolean two-level view, no Global/Voice node, no parent→children read | `constellation-scene.ts:19-25` · `NodesView.vue:56-95,138+` · `use-project-nodes.ts:59,71` | ×4 |

### P3 / latent (recorded, not ranked)

Fail-open unpersisted approval branch (`handle-approval-requested.ts:43-56` — unreachable with today's
provider because `run-claude-chat-session.ts:227-280` yields `session-started` before the synthetic
queue is drained; a second provider reintroduces a permanent lock leak) · two bare writes where one
transaction is the rule (`run-delegation-claim-and-run-tick.ts:821,832`, `settle-failed-delegation-attempt.ts:59-60`)
· `continueEnabled:false` drops continuity AND the writer lock in one flag (`chat-turn.ts:142,292-299,475-478`; no UI)
· `createApp` `??`-defaults the shared registries (`app.ts:228-232`) · a colleague whose identity resolve
failed enqueues targetless (loses same-colleague FIFO) · voice continuation anchor row carries a
contradictory attribution · a voice compaction swap titles the segment "Voice conversation" · carry tail
budgeting `break`s on the first overflow line · a mid-turn compaction swap splits one turn across two
segments (chain-walkers cope) · global + voice share one cwd for concurrent seeded swaps (unexamined).

---

## 2. Stuck points (how · recovery)

| # | Stuck point | How | Recovery today |
|---|---|---|---|
| 1 | Voice / channel / delivery turn on an approval card | floor tool under `bypass-with-behavior-gate`; unbounded `await` | reaper denies at `requestedAt + 2×timeoutMs` (~10 min); the desktop app's approval toast (attributed to Global) if open |
| 2 | Any interactive turn on `ask_user` (voice = fatal) | unbounded by design; no periodic reaper | user answers / dismisses; on voice — restart |
| 3 | Voice daemon `busy` forever | no turn budget, no fetch abort, mic audio dropped while busy | daemon restart |
| 4 | Global root lock wedged by a parked turn | promise-chain serializer, no deadline | resolve the park, or restart |
| 5 | Global report delivery queued on the root lock | burns a pool slot + the 600 s budget, then `failed` (not requeued) | none — report body only survives in the late-running turn |
| 6 | Wedged in-process run holds its target key | no lease; waiters uncancellable | process restart only (boot reap) |
| 7 | Queued user turn parks behind a holder | `await locks.acquire` unbounded; disconnect does not cancel (deliberate) | holder releases |
| 8 | Second global/voice turn looks frozen | no `turn-queued{busy}` sentinel | resolves when the holder finishes |
| 9 | Delegation timeout ≠ cancel | the run keeps going, un-observable, lock released early (L1) | none — it is invisible, not stuck |
| 10 | Root lock held through a boundary swap | 240 s distill + 120 s priming inside the lock (~6 min worst case) | bounded; queued deliveries burn budget meanwhile |
| 11 | Voice auto-continuations after the daemon left | up to 3 continuations on the voice lock | self-heals at the cap |
| 12 | Restart mid-swap / mid-checkpoint | in-process registers lost | anchor row survives; the automatic continuation does not |

**Bounded and correct (verified):** retries (3 attempts, `[30 s, 300 s]` backoff) · continuation cap
(3, terminal-gated, reset per genuine turn) · `runSeededSwapSession` priming deadline with a real
interrupt · swap register clears in `finally` · root lock cannot wedge on a failed turn (both handlers) ·
teardown reap of `started` tool calls · boot reaps (session turns, tool calls, asks, approvals, processes,
claimed jobs) · a client abort mid-turn does not lose the boundary swap (Hono's `StreamingApi.write`
swallows write errors, so the generator reaches the swap).

---

## 3. Modes · models · effort · buildout — binding and inheritance

Rule everywhere interactive: `input ?? chat_sessions row ?? surface default`
(`packages/chat/src/settings/resolve-turn-session-settings.ts:31-35`); write-through is input-only.

| Path | mode | model | effort | buildout | Truth |
|---|---|---|---|---|---|
| Global web | input ?? row ?? **core `bypass-with-behavior-gate`**; header stamped only when resolved | input ?? row | input ?? row | written, never read | row + request |
| Voice spoken (wake / overlay) | input only → bypass-w-gate; row never read/written | `VOICE_TIER_MODEL` + fit clamp | `low` | — | one home `contracts/chat/voice-tier.ts` (4 legs verified) |
| Voice typed (panel) | `ui.composerMode` (may be **`ask`**) | row ?? tier, clamped | row ?? `low` | — | the chip → PATCHes the voice row |
| **Voice CALL** | **`ask`** | tier, **no clamp** | tier | **written** | route default — V1 |
| Workspace chat | input ?? row ?? **`ask`**; header only when resolved (T1) | input ?? row | input ?? row | inert | row + request |
| Spawned / agent DM | same; row born **NULL** (T2) | | | | |
| Delegation enqueue → job | `x-vynel-delegation-mode` (all 3 streams + delegated composer stamp — the 08-19 fix holds) | tool arg else NULL | tool arg | — | `delegation_jobs` |
| delegate-to-* runners | job ?? bypass-w-gate | job model, **no fit guard**, target's own `selectedModel` never read | job effort | — | job row |
| Agent-run job | job | job ?? `agent.model` | **always NULL** (T3) | — | |
| Leaf | hardcoded bypass-w-gate | model only | — | — | by design |
| Report / update / direct delivery | NULL → bypass-w-gate (deliberate) | NULL | NULL | — | |
| Note delivery | caller's mode | NULL | NULL | — | |
| Channels | none → bypass-w-gate (locked) | passthrough | none | — | |
| Swap segment | copy-forward (both homes, + status trio) | ✓ | ✓ | ✓ | predecessor |
| Continuation (interactive) | the genuine turn's closure values | ✓ | ✓ | — | |
| Checkpoint follow-up job | copied from the parent job | ✓ | ✓ except agent-run branch | — | |

Gaps ranked: V1 → T1 → T3 → M1 → T2 → V7 → T4.

---

## 4. Improvements the arcs missed

The concise list is Tier C above. Three structural observations worth stating on their own:

1. **Every background path has a budget; no interactive path has one; the interactive global path holds a
   lock the background paths need.** That single asymmetry is the root of the G1 cascade
   (`ask_user` → root lock → channels → deliveries fail).
2. **The display layer infers identity the wire refuses to carry.** The feed is two-valued
   (`'global' | 'workspace'`) for a five-scoped system, so voice, spawned and agent turns masquerade and
   every reader re-derives identity from `primarySessionId ?? null` heuristics. V2 and its siblings are
   symptoms; one vocabulary change is cheaper than fencing N readers.
3. **Stale invariant comments are load-bearing here.** Several findings came from a comment that no
   longer matches the code (`use-session-statuses.ts:49-50`, `build-claude-can-use-tool-callback.ts:21-23`,
   `constellation-scene.ts:31`). In a codebase this comment-dense, a wrong comment is a bug report waiting
   to be believed.

---

## 5. Monitoring binding + node display

**Interpretation (all five agents converged):** (a) the Nodes constellation view; (b) the wider live
monitoring binding.

**(a) Binding is honest — enlargement is structurally blocked.** `resolveNodeStatus` is a pure palette
rename of the real ladders; fleet dots take `use-workspace-status`, project dots take
`deriveSessionStatus`; nothing is invented; `hasAnswered` gates painting (except at the fleet level —
N2). But: levels are a boolean (`drilledProjectId` + `isInsideProject` branching six computeds); node
identity is prefixed strings (`continuing:` / `session:`) minted and parsed in three places; `SceneNode`
is `{id, name, initials, status}` with no kind/parent/detail; the project read is the shared 50-cap
unscoped page filtered client-side (N1); there is no Global or Voice node and no data source for a third
level (children are thread-keyed via `resolveDelegationTrace`, not parent-keyed); scene buffers are
index-keyed and the index-linear orbit layout leaves the stage from ~the 9th node. **Why enlargement is hard:** there
is no adapter layer between session truth and the scene vocabulary — each level hand-builds its own list.
**What to change:** `SceneNodeRef` union + a level stack + `SceneNode.detail` + count-aware layouts +
a scoped project read + a `GET /sessions/:id/children` (or a tree shape on the overview) built from
`session_turns.primarySessionId` + `delegation_jobs.threadId`, which already model the relation.

**(b) One truth with named seams.** `SessionActivityFeed` → `session_turns` mirror → `LiveChannelHub`
(one WS per window) → `activity-store` → `use-session-statuses` → `deriveSessionStatus` is genuinely one
pipe; the sidebar/agent-run panes key by session id and are safe. Drift: voice is *invisible* to the
status half (V3) and *over-visible* to the liveness half (V2); three private liveness predicates
(`activity-store`, `use-session-statuses`, `VoiceChatPanel` — the arc's review fixed only the third);
"The build" wears the room's status while its sibling dots derive their own (documented over-claim);
two global-status derivations coexist (`globalStatusView` vs `use-workspace-status.globalStatus`) and
agree only by precedence; `/activity/running` (the durable "rebuild seed") has no consumer; the SDK's
`system/api_retry` frames are still not surfaced (a 100 s retry reads as idle).

---

## 6. Session continuity everywhere

Coverage is **complete** — verified by all five agents, and by a call-site census (5 production
`consumeSessionEventStream` sites ↔ 5 `withBoundaryContinuity` sites): global web · global channels ·
voice (own primary + own lock; swap segments inherit scope) · report/update/note delivery (swap yes;
checkpoint/auto-continue deliberately off) · workspace chat (when `isContinueActive`) · spawned/agent DM ·
delegate-to-workspace-root/spawned/agent · agent-run job · monitor/schedule/task wakes (they enqueue into
the same rails; schedules start a fresh session per fire, so nothing to continue; leaves are one-shot by
design). `whoami` + duty-book binding on all of them.

Where it can break, ranked: **L1** (a timed-out run's swap runs outside any lock, concurrently with the
next turn — the single most damaging continuity break) · **C1** (restart amnesia of the interactive
checkpoint) · voice auto-continue vs a departed daemon (V5) · `chat_sessions.model` doubling as the
pressure denominator (a small-model delegated turn rewrites it; today masked by M1) · a fresh swap segment
has `model = NULL` until its first usage report (fit guard falls to engine default; the fold's chain-level
fallback is used by neither) · voice + global concurrent seeded swaps in one cwd (unexamined) · the carry
tail `break`s early on one long line · the mid-turn compaction split. Recorded and holding: the
`<synthetic>` fix at the translator (one measuring home), the carry-fidelity floor, the continuation cap.

---

## 7. Score rubric

| Axis | A1 | A2 | A3 | A4 | A5 | Lead | Why |
|---|---|---|---|---|---|---|---|
| Correctness | 7 | 6 | 7 | 6 | 6 | **6.5** | primitives right; three silent loss/leak classes at the seams (L1, G2, V2) |
| Stuck-resistance | 6.5 | 5 | 5 | 6 | 4 | **5** | boot recovery excellent; running recovery thin — no lease, no deadline, unbounded human-waits on card-less surfaces |
| Settings integrity | 6.5 | 7 | 7 | 6 | 6 | **6.5** | the `input ?? row ?? default` spine is clean; five partial carries + one dead column + a two-mode voice thread |
| Observability | 8 | 6 | 7 | 8 | 6 | **7** | one pipe, one ladder; voice absent from status, over-present on liveness |
| Continuity | 8.5 | 8 | 8 | 8 | 8 | **8** | complete, uniform, unforgettable-by-construction; process-only registers |
| Voice | 6 | 5 | 6 | 6 | 4 | **5.5** | the right design; the operational envelope (mode, stop, cards, status, daemon deadline) unfinished |
| Tests | 8 | 7 | 8 | 7 | 8 | **7.5** | real SQLite, regressions pin their incidents; the `apps/`↔`packages/` seams — where every P1 lives — are untested |
| Code health | 8.5 | 8 | 6 | 9 | 8 | **8** | exceptional WHY-comments; two files over the cap (911-line tick, 503-line root routes) |
| **Overall** | 7.5 | 6.5 | 7 | 7 | 6 | **7** | |

---

## 8. Voice session review

**Trace (verified by all five):** wake word → `VoiceSessionDriver.#runTurn` (busy, no deadline) →
`createBrainClient` POST `/root/turn {voice:true, VOICE_TIER_MODEL, low}` → `streamGlobalRootTurn`
branches on `input.voice` → `resolveVoiceConversationTarget` (scope `'voice'`, **same hidden cwd** as
global) → settings not read/not written → fit clamp → `activityFeed.begin({scopeKind:'global',
origin:'voice'})` (V2) → core: lock `${userId}:voice`, hidden `'voice'` segments, catch-up SKIPPED,
`permissionMode` default `bypass-with-behavior-gate` (W1) → `withBoundaryContinuity` → the reply arrives
via the `speak` tool (4 s-bounded `speakThroughDaemon`) → `onSpeak` four-party router → `LineSpeaker` /
overlay via `voice-daemon-relay` (one link per surface). The daemon returns at the first
`session-completed` (V5). The web overlay leg runs the same server path with its own player; the
Voice-chat panel reads two UI-only doors and sends real voice turns.

**What is right:** the thread split (own identity, own lock, catch-up skip) is the correct fix for the
08-19 incident; the server-side wall holds in every direction probed (chat-search fence, sessions-route
forbidden scopes, `isTurnFromGlobalRoot`, the fold, `list_sessions`, `send_message to:session:` 404s,
the socket's per-subscribe ownership check); the pins live in ONE home consumed by four legs (the "three
pins — one home?" question is closed: yes); the note-to-global rail is tight; no double-speak path found.

**Where it breaks (ranked):** V1 call-leg `ask` · W1 unanswerable cards / asks + deaf daemon · V2 feed
identity · V4 Stop reaches global · V3 no status anywhere · V5 auto-continue vs departed daemon · V6 dead
`onSpeak` branch · V7 typed/spoken split · D2 notes destroyed by restart · `mapFrameToBrainEvent`
recoverable-as-failed · a spoken turn's panel transcript may read as tool calls (the brain answers via
`speak`, text deltas ignored) — check in the live smoke.

**Verdict on the recorded open forks (five agents, one voice):**

| Fork | Verdict |
|---|---|
| `direct_to_user` answers reach only the global catch-up net | Right problem, **not first** — G2 shows that net can be consumed by a turn that never ran, and V6 is a strictly larger hole through the same surface. Fix G2 + V6 (+ V3) first; then either voice-thread absorption or a spoken notice is a small addition. |
| Voice-fired TASKS parent on the global conversation | **Correct as-is; leave it.** Coherent with "voice shows under global"; the only thing keeping a voice-fired task visible while voice has no status. Revisit after V3. |
| Split the 503-line `routes/root/index.ts` | **Do it while fixing V4** (the interrupt route lives there) — and because the two `/voice-chat/*` doors are the only owner-scoped, no-`x-mcp` routes in a file of tool-exposed ones. Hygiene, not risk. |
| Per-call sessions gain the routing toolset | **Not until V1 + W1.** Adding carding tools to an `ask`-mode session on a card-less live call multiplies the park class onto every routing tool. The mode gate is a prerequisite, not a follow-up. |

**Ranked voice improvements:** V1 → W1 (card-less policy + daemon budget/abort/watchdog + bounded ask) →
V2 (one line) → V4 → V3 → V5 + V6 → V7 (Kafi's call) → routes split → `direct_to_user` → per-call toolset.

---

## Verified clean (don't re-spend budget here)

- The voice/global wall on every server reader and on the socket; `list_sessions` cannot reach voice; the
  self-read lift accepts both scopes.
- Settings copy-forward on a swap is complete in both homes (four columns + the status trio).
- Restart safety at boot: report deliveries requeue, other claimed rows fail + push an honest failure
  delivery, `session_turns` + tool calls + asks + approvals + processes reaped.
- Retries bounded; continuation cap bounded and terminal-gated; swap register `finally`-safe; root lock
  cannot wedge on a failed turn; the consume loop's teardown reap.
- The `<synthetic>` fix (translator drops usage from synthetic messages; one measuring home).
- The 2026-08-19 mode-header fix is real and complete across all four writers.
- Ownership / `userId` gating at every continuity op.
- The three (four) voice pins live in one contracts home.

## Method

Five `general-purpose` Opus agents, identical brief (8 questions, evidence standard: every P0/P1
traced hop-by-hop or reproduced by a throwaway vitest run from the worktree root), different suggested
entry points, audit-only (no source edits left behind; `git status` clean). Reports: `agent-1.md`
(interactive streams entry) · `agent-2.md` (global + voice) · `agent-3.md` (delegation engine) ·
`agent-4.md` (continuity + settings) · `agent-5.md` (monitoring UI). The lead read all five, then
re-verified each P1 in the checkout before ranking.
