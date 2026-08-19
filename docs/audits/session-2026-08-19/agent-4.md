# Vynel SESSION SYSTEM — independent audit (Agent 4)

Worktree `feature/session-audit` @ `06781328`. All cites are `path:line` in that tree.
**CONFIRMED** = traced end-to-end hop-by-hop, or reproduced with a throwaway vitest I ran.
**PLAUSIBLE** = strong reading, not fully traced.
Findings tagged **[NEW]** are not in `.claude/STATE.md`; **[KNOWN]** confirms/ranks a recorded residual.

One repro test was written and run (`packages/session/src/runtime/audit-agent-4-catchup-loss.test.ts`,
passing) and **deleted** before finishing — its assertions are quoted under B1.

---

## 1. Bugs for session — ALL scopes

### B1 · P1 · global · Catch-up delegation reports are marked "surfaced" before the turn starts — a failed turn loses them forever · **[NEW]** · CONFIRMED (reproduced)

**Where:** `packages/session/src/runtime/compose-global-root-provider-message.ts:40-56`, called from
`packages/session/src/runtime/run-global-root-turn-core.ts:181` — **before**
`provider.startChatSession(...)` at `:195`.

```ts
// compose-global-root-provider-message.ts:54-56
if (reports.jobIds.length > 0) {
  markDelegationsSurfacedToRoot(db, reports.jobIds, new Date())
}
```

**Evidence of scope:** `collectDelegationReportsForRoot` is the ONLY channel by which the global brain
learns that a delegated task **failed**, completed with no text, an @mention colleague finished
without speaking, or a `direct_to_user` answer landed
(`packages/orchestration/src/queries/collect-delegation-reports-for-root.ts:36-69`). `surfacedToRootAt`
is never un-marked; nothing re-collects.

**Failure scenario:** three background tasks finish (one failed). The user types in the global chat while
the engine is unreachable (or the model id is rejected, or the prompt is too long). `runOneGlobalTurn`
composes the message, marks all three surfaced, then `startChatSession` throws. `GlobalRootSseSink.onError`
renders one error row. The user retries; the catch-up block is now empty. The assistant never mentions
the failed task and will say "still working" if asked.

**Repro (ran, passed, then deleted):**
```ts
expect(collectDelegationReportsForRoot(db, { userId }).jobIds).toEqual([jobId])   // before
// FakeAiAgentProvider throws inside startChatSession
await runGlobalRootTurnCore(deps, input, sink)
expect(sink.errors).toHaveLength(1)                                               // turn failed
expect(collectDelegationReportsForRoot(db, { userId }).jobIds).toEqual([])        // reports gone
```
`npx vitest run --project node ...audit-agent-4-catchup-loss.test.ts` -> 1 passed.

**Minimal fix:** move the mark to the point the turn is provably underway — the consumer's
`session-started` / `user-message-persisted` (the same seam `persistTurnSessionSettings` uses), or pass
`reports.jobIds` down and mark them from `runOneGlobalTurn` after the first yielded event. A second, free
improvement: each continuation turn re-runs collect+mark (`:181` is inside the per-turn function), which
is harmless today but makes the mark's placement even more arbitrary.

---

### B2 · P1 · voice/global · A voice turn is announced as a **global** turn with no `primarySessionId`, so the Global chat can bind to the VOICE conversation — and it sticks · **[NEW]** · CONFIRMED

**Chain (every hop):**
1. `apps/local-api/src/streams/global-root-turn.ts:321-325` — a voice turn begins its feed entry as
   `scopeKind: 'global'`, `origin: 'voice'`, and stamps **no** `primarySessionId`:
   ```ts
   const activity = c.var.activityFeed.begin({
     userId: c.var.user.id, scopeKind: 'global',
     origin: input.voice === true ? 'voice' : 'web',
   })
   ```
2. `packages/contracts/src/chat/session-activity.ts:35` — the wire type has no `'voice'`:
   `scopeKind: 'global' | 'workspace'`.
3. `apps/local-web/src/stores/activity-store.ts:61-76` — `runningPrimarySessionIdFor({kind:'global'})`
   skips only turns that carry a `primarySessionId`:
   ```ts
   if ((turn.primarySessionId ?? null) !== null) continue
   if (scope.kind === "global" && turn.scopeKind === "global") return turn.sessionId
   ```
4. `apps/local-web/src/composables/chat/use-continuing-conversation.ts:66-71` —
   `continuingQuery.data.value?.currentSdkSessionId ?? runningId.value ?? lastRunningId.value`, and
   `lastRunningId` is sticky (`:59-65`, forgotten only on scope change).
5. `apps/local-web/src/views/GlobalChatView.vue:114-121` — that id IS the session the Global chat renders.

**Failure scenario:** a user whose global thread has never run a turn (`currentSdkSessionId` null — fresh
install, or the user speaks before they type) wakes by voice. The Global chat binds to the **voice**
segment id and keeps it after the voice turn ends, until a real global turn runs. The private spoken
thread is exactly what the Chad-locked cross-session wall exists to keep out of every other surface — the
wall was closed on the *tool* and *route* readers (`chat-search.ts:76`, `routes/sessions/index.ts:251`)
but not on the *live-monitoring* reader.

**Same root cause, second symptom (P2):** `apps/local-web/src/composables/sessions/use-session-statuses.ts:49-55`
claims the pre-resolution window of any null-session global turn for the **Assistant** entry, on an
invariant its own comment states and that voice now falsifies: *"every OTHER global-scope turn on the feed
is a spawned session's, and those always carry their session id from the start."* A voice turn in that
window makes the Assistant entry read `running`, which in `deriveSessionStatus` hides a standing `problem`
and supersedes a standing `needs_input` on the global conversation.

**Minimal fix (structural):** widen `SessionTurnActivity.scopeKind` to include `'voice'` and stamp it at
`global-root-turn.ts:323`; the two places that deliberately want voice to show *under* Global (the presence
dot `activity-store.ts:26`, the origin copy `:31`) opt in explicitly. The one-line stopgap is
`&& turn.origin !== 'voice'` at `activity-store.ts:67` and `use-session-statuses.ts:53`.

---

### B3 · P1 · voice (call leg) / spawned · A per-call voice session runs in **ask** mode on a surface with no card renderer · **[NEW]** · CONFIRMED

**Chain:**
1. `apps/voice/src/call/call-session-client.ts:32-38` — the call turn body carries model + effort and
   **no `mode`**:
   ```ts
   return streamTurnEvents(`${apiUrl}/sessions/${sessionId}/turn`, {
     userMessageText: utterance, model: VOICE_MODEL, thinkingEffort: VOICE_THINKING_EFFORT,
   })
   ```
2. `packages/chat/src/turn-consumption/build-new-chat-session-row.ts:39-57` — a newly created session row
   carries **no** settings columns, so a spawned session is born `sessionMode = null`.
3. `apps/local-api/src/streams/session-turn.ts:94-95` —
   `toPermissionMode(turnSettings.mode ?? DEFAULT_SESSION_MODE)`; `DEFAULT_SESSION_MODE = 'ask'`
   (`packages/session/src/session-mode.ts:77`).
4. `apps/local-api/src/streams/session-turn.ts:224` — `permissionMode: turnPermissionMode` -> the provider.
5. `packages/providers/src/claude/approvals/tool-approval-policy.ts:6-12` — under `ask` the floor + the
   per-turn mutating set + *"Native tools the SDK routes to the callback in ask mode keep carding"*.

**Failure scenario:** mid-call the assistant reads a file or writes a note. `canUseTool` parks. Nobody can
answer — the daemon renders no cards and the call has no UI. The approvals reaper denies it after the
5-minute default (`packages/approvals/src/requests/record-approval-request.ts:31`) plus up to 60 s of
reaper granularity (`apps/local-api/src/services/approvals-recovery-service.ts:15`). The caller hears five
minutes of silence, then a refusal. Contrast the *wake* line, which hits `/root/turn` and gets the core's
`bypass-with-behavior-gate` default (`run-global-root-turn-core.ts:202`).

**Minimal fix:** the call client sends `mode: 'bypass'`, or the server treats a spawned-session turn with
no resolvable settings and no user surface as unattended. The rule the codebase already states —
*"a background turn carries no user trust pick, so the floor holds"* — should apply here instead of the
interactive `ask` default.

---

### B4 · P1 · delegation / workspace / spawned · A timed-out delegated run releases its target lock while the turn keeps running and writing · **[NEW]** · CONFIRMED

**Chain:**
1. `packages/orchestration/src/routing/route-request.ts:138` — `await Promise.race([delegationPromise, wait.promise])`.
   `wait.cancel()` only clears the timer; **the delegate promise is never cancelled**.
2. `packages/session/src/delegation/run-delegation-claim-and-run-tick.ts:816-843` — on `timed-out` the tick
   calls `failDelegationJob(...)`, logs *"the workspace turn keeps running in its own session"*, and
   returns `true`. Budget: `DELEGATION_RUN_BUDGET_MS = 600_000` (`:81`).
3. `apps/local-api/src/services/delegation-service.ts:203-224` — the tick's `.finally()` runs
   `activeRunCount -= 1` and `releaseTargetLock()`.
4. `packages/session/src/delegation/session-target-locks.ts:47-58` — release hands the key to the next
   waiter or frees it; the next 1 s poll claims another job for the same target key.
5. Meanwhile the abandoned turn is still inside `delegate-to-workspace-root.ts` and will still run
   `linkPrimarySessionToSdkSession` at `:274` and the boundary swap at `:234` — under a lock it no longer
   holds. That file's own comment states the invariant this breaks: *"under the tick's target lock, so the
   swap lands before the next task resumes this brain."*

**Failure scenario:** any delegated task longer than 10 minutes — which is the class of task the queue
exists for. Two writers on one resumed SDK session; the dead turn's later swap repoints the primary out
from under the live successor. Silent: the row is `failed`, `cancelHandle.end()` already ran (`:875`) so
Stop answers `already-finished`, and `activityHandle.end()` (`:876`) removes it from the feed.

**Minimal fix:** make the lock's lifetime follow the *delegate promise*, not the tick's return — release
from the delegate's own `finally`, or thread an `AbortController` the budget trips so a timed-out run is
genuinely stopped.

---

### B5 · P2 · orchestration / voice · A restart destroys `direct-delivery` and `note` rows (the voice->global note rail) · **[NEW]** · CONFIRMED

`packages/orchestration/src/repositories/delegation-jobs.ts:567` —
```ts
or(isNull(delegationJobs.jobKind), ne(delegationJobs.jobKind, 'report-delivery'))
```
Only `report-delivery` requeues (`:584`); everything else claimed at crash time is set `failed` **with
`surfacedToRootAt: at`** (`:558-561`), so the root never learns. The file's own justification covers
`update-delivery` ("ephemeral status") and never mentions `direct-delivery` — which carries a **final
answer addressed to the user** — nor `note`, which since 2026-08-19 is how the **voice thread hands the
global thread a thought** (`enqueue-note-delivery.ts`). The window is small (one transaction) but the loss
is total and silent.

**Fix:** add `'direct-delivery'` and `'note'` to the requeue set.

---

### B6 · P2 · voice · One thread, two permission modes and two models, depending on whether you typed or spoke · **[NEW]** · CONFIRMED

- Typed: `apps/local-web/src/components/chat/VoiceChatPanel.vue:131-138` sends the composer `settings`;
  `apps/local-web/src/composables/chat/use-chat-turn.ts:176-180` puts `model` / `mode` / `thinkingEffort`
  in **every** turn body including the voice one. `use-session-settings.ts:91-98` resolves `mode` as
  `server?.sessionMode ?? surfaceDefaults?.mode ?? ui.composerMode` — the panel passes no `mode` in
  `surfaceDefaults` (`VoiceChatPanel.vue:200-203` sets only `modelId` + `thinkingEffort`), so it falls
  through to `ui.composerMode`, whose stored default is `DEFAULT_SESSION_MODE = 'ask'`
  (`ui-store.ts:97-102`).
- Spoken: `apps/voice/src/brain/run-brain-turn.ts:101-106` sends no `mode`, and
  `global-root-turn.ts:150-155` deliberately **skips the row read for voice**, so the core's
  `bypass-with-behavior-gate` applies.

So the Voice-chat mode chip reads "Ask" and is honoured for typed turns while every spoken turn on the
same conversation bypasses. Same for the model: a chip change PATCHes `selectedModel` onto the voice row
(and it copy-forwards across swaps via `record-swap-segment-session.ts:102-112`), typed turns honour it,
spoken turns always run `VOICE_TIER_MODEL`.

This is a *trust-surface* inconsistency, not cosmetics: the mode chip is the user's stated trust level,
and the surface that most needs the floor (hands-free) is the one that ignores it.
`docs/module-notes/voice-session.md:106-107` describes this as intended; the locked semantics in STATE.md
("VOICE turns neither read nor write settings") describe the opposite. **The two records disagree — Kafi
should settle it.** Recommendation: the panel passes `mode` in `surfaceDefaults` and the chip is hidden
(or read-only "Bypass — hands-free") on the voice surface.

### B6b · P3 · voice · The daemon's fit clamp also silently overrides a **human's** explicit model pick · **[NEW]** · CONFIRMED

`apps/local-api/src/streams/global-root-turn.ts:182` gates the clamp on
`isVoiceTurn && turnModel !== undefined && conversationTarget.resumeSdkSessionId !== null` — it keys on the
*surface*, not on who chose the model. For a **typed** panel turn all three hold (the panel always sends a
`modelId`), so a user who deliberately picks Opus in the Voice-chat composer has it swapped for the
session's last-ran model whenever occupancy exceeds Opus's window, with **no UI signal** — only
`logger.info('voice model pin cannot hold the session occupancy…')` at `:189`. The substitution is right for
a daemon *pin* (nobody chose it, and the alternative is a hard failure) and wrong for a human *pick*
(silently running a different model than the chip shows). Minimal fix: clamp only when the model came from
the surface's pin, not from `input`, or surface the substitution as a turn notice.

---

### B7 · P2 · nodes · Constellation scratch buffers are keyed by array index, so a reorder silently reassigns dots · **[NEW]** · CONFIRMED

`apps/local-web/src/utils/constellation-scene.ts:760-766`:
```ts
if (next.length !== nodes.length) { positions.length = 0; particles.length = 0 }
```
The overview is sorted `lastMessageAt` desc (`fold-session-chains.ts:85`), so a same-length reorder (any
session speaks) hands each dot's screen position, colour and in-flight particles to a *neighbour's* node;
a length change resets **all** positions so the whole constellation jumps. Fix: key by node id.

### B8 · P2 · nodes / sessions monitor · The app-wide 50-entry overview cap is applied unscoped, then filtered client-side · **[NEW]** · CONFIRMED

`apps/local-web/src/composables/sessions/use-sessions-overview.ts:17` calls `vynel.sessions.overview()`
with no args -> server `DEFAULT_ENTRY_LIMIT = 50` (`packages/session/src/overview/get-sessions-overview.ts:40`),
**every scope**, then `use-project-nodes.ts:68` filters `row.workspaceId !== workspaceId` in the client.
Past 50 conversations user-wide, drilling into a quiet project shows zero session dots + "Nothing running
in here yet", and `LiveSessionPane.vue:22-30` silently drops to view-only with no note for any session
outside the page. Fix: pass `scope: { workspaceId }` (the param exists and is documented for this).

### B9 · P3 · voice · The fit guard covers the turn but not the turn's @mention dispatches · **[NEW]** · CONFIRMED
`global-root-turn.ts:369` runs the core on the fitted `turnModel`, but `:248` builds `mentionPlan` from
the **unfitted** `turnSettings.model`. A voice turn whose pin was set aside still dispatches its agent
leaves on the too-small pin.

### B10 · P3 · delegation · Two bare writes where the codebase's own rule is one transaction · **[NEW]** · CONFIRMED
`run-delegation-claim-and-run-tick.ts:821` (`failDelegationJob`) and `:832`
(`markDelegationsSurfacedToRoot`) are separate statements; same shape in
`settle-failed-delegation-attempt.ts:59-60`. A crash between them leaves the row failed-but-unsurfaced, so
the root narrates "couldn't complete the task" for work already reported. (Invariant 5 of CLAUDE.md.)

### Checked and clean (worth recording)
- Ownership / `userId` gating is consistently enforced at every continuity op
  (`apply-primary-turn-continuity.ts:104-107`, `build-continuity-context.ts:111-114`,
  `bridge-primary-session.ts:69-72`) — no leak found.
- The swap's state change + `session.swapped` **are** co-committed (`bridge-primary-session.ts:202-219`);
  `session.swapping` / `session.swap-aborted` bracket every exit path including a throw (`:87-131`).
- `handleSessionStarted` correctly creates a row for a mid-turn compaction id and chain-links +
  scope-inherits it (`:99-134`) — the orphaned-segment class is closed.
- `reapOrphanedSessionTurns` is wired at boot (`apps/local-api/src/boot.ts:304`), so `session_turns` do not
  ghost across a restart.
- SSE writes never throw on a disconnected client (`hono@4.12.27` `utils/stream.js` `write()` swallows), so
  a client disconnect cannot abandon a boundary swap mid-generator. I checked this specifically because
  `withBoundaryContinuity` suspends at `yield 'context-patching'` *before* running the swap.

---

## 2. Where a session can get STUCK while running

| # | Sev | Where | How it wedges | Recovery |
|---|-----|-------|---------------|----------|
| S1 | **P1** | `run-delegation-claim-and-run-tick.ts:816-843` + `delegation-service.ts:203-224` | B4: budget expires, lock released, turn runs on. Two writers; the successor's head can be swapped away | **None** while the process lives. Restart only. CONFIRMED |
| S2 | **P1** | `packages/orchestration/src/repositories/delegation-jobs.ts:193` | `claimedAt` is written and **never read as a lease** (its only reader is `attach-delivered-run-stats.ts:109`, for display). A genuine hang (an SDK stream that stalls *after* the 90 s startup gate) leaves the row `claimed` and its target key held | Boot pass only (`delegation-service.ts:117-135`). No periodic sweep. CONFIRMED |
| S3 | **P1** | `session-target-locks.ts:34` | `acquire()` is an unbounded, uncancellable wait. The user's interactive turn parks there (`chat-turn.ts:488`, `session-turn.ts:263`) after one `turn-queued` frame. A stalled holder starves every later user turn *and* every pending delegation to that target — the claim excludes the key each tick, so those rows never drain and never expire | Release IS correctly in `finally` at both sites; the defect is the unbounded wait, not a leak. CONFIRMED |
| S4 | **P1** | `runtime/root-turn-lock.ts:24-33` | A promise chain with **no deadline**. One global turn that never settles wedges web + channel + every global report-delivery for that user forever (voice is now a separate key — the arc's real win). Those delivery jobs then burn their 600 s budget *queued* and die at `run-report-delivery-tick.ts:429-437`, which — unlike the `failed` branch at `:446` — does **not** `requeueIfRecoverable`. If the turn never started, the report body is the only copy | None. CONFIRMED |
| S5 | **P1** | voice call leg, B3 | Ask-mode card on a card-less surface: the turn parks in `canUseTool` | Reaper denies after ~5 min (`record-approval-request.ts:31`). Bounded but call-fatal. CONFIRMED |
| S6 | P2 | `handle-approval-requested.ts:43` | An `approval-requested` arriving before `session-started` is forwarded **without** a persisted row (`sessionId` is only assigned in the session-started branch, `consume-session-event-stream.ts:231`; the resumed-turn early persist at `:148-177` does not set it). No row => the reaper is blind => `canUseTool` parks forever | None. Narrow (needs an init/tool race). PLAUSIBLE |
| S7 | P2 | `enqueue-checkpoint-continuation.ts:110` + `pending-checkpoints.ts:97-108` | `continuationJobsById` entries for follow-up jobs never claimed (cancelled, purged) are never taken | Unbounded-but-tiny process leak; a restart clears it. CONFIRMED |
| S8 | P2 | task-execution | `ask_user` is absent on the delivery turn that receives a task nudge; extending it would hold the target's delivery queue while parked | Design fork, not a bug. **[KNOWN]** |

**Bounded and correct (checked):** retry attempts cap at 3 with `[30 s, 300 s]` backoff
(`classify-turn-failure.ts:13-20`); the continuation depth caps at 3 (`pending-checkpoints.ts:63-67`) and a
genuine turn resets it (`:75-78`); `runSeededSwapSession` has a 120 s priming deadline **and a real
interrupt on timeout** (`run-seeded-swap-session.ts:96-123`) — the one place an unbounded provider await
would have been fatal, since `createSpawnedSession` runs it inside an MCP tool; the boot recovery pass for
claimed jobs is thorough and pushes an honest per-orphan failure.

**Worst stuck-risk: S1.** It is not an edge case — it is the routine outcome of any delegated task past ten
minutes, and it produces exactly the state every comment in the delegation package swears cannot happen:
two writers on one resumed SDK session, invisibly.

---

## 3. Are mode / model / effort / auto-buildout bound and carried to children?

`resolveTurnSessionSettings(input, row)` (`packages/chat/src/settings/resolve-turn-session-settings.ts:27`)
is `input ?? row ?? undefined`; **`autoBuildout` is not in it at all** — the composer sends it
(`use-chat-turn.ts:181`) and no turn path reads it back. It is stored, copy-forwarded, PATCHable, and bound
to nothing. That is the cleanest single gap in the settings spine.

| Path | mode | model | effort | buildout | Source of truth | Verified by |
|---|---|---|---|---|---|---|
| Global web chat | `input ?? row ?? core default (bypass-w-gate)`; header-stamped only when resolved | `input ?? row` | `input ?? row` | ignored | `global-root-turn.ts:150-170` | read |
| **Voice — spoken** | no `mode` sent => **bypass-w-gate**; row deliberately not read | `VOICE_TIER_MODEL`, clamped by `fitPinnedModelToSession` | `low` | ignored | `run-brain-turn.ts:101-106` -> `global-root-turn.ts:129-195` | read |
| **Voice — typed (panel)** | `ui.composerMode` => **'ask'** (B6) | row `selectedModel` ?? `VOICE_TIER_MODEL`, and the **daemon fit clamp fires on it too** (B6b) | row ?? `low` | ignored | `VoiceChatPanel.vue:131-203`, `use-chat-turn.ts:176-181`, `global-root-turn.ts:182` | read |
| Workspace chat | `input ?? row ?? 'ask'` | `input ?? row` | `input ?? row` | ignored | `chat-turn.ts:112-119, 175-178` | read |
| Spawned / agent DM | `input ?? row ?? 'ask'` — and a spawned row is **born all-NULL** | `input ?? row` | `input ?? row` | ignored | `session-turn.ts:94-95`; `build-new-chat-session-row.ts:39-57` | read · **[KNOWN, confirmed]** |
| **Voice call turn** | **'ask'** on a card-less surface (B3) | `VOICE_TIER_MODEL` | `low` | ignored | `call-session-client.ts:32-38` | traced |
| Delegation enqueue | parent's resolved mode via `x-vynel-delegation-mode` (all three interactive streams + the delegated composer now stamp it) | **the model's own tool input**, else NULL | same | ignored | `delegation-mode-header.ts:42-50`; `routes/routing/index.ts:411-423, 452-459` | read |
| `delegate-to-workspace-root` | job `permissionMode ?? bypass-w-gate` | job `model` only — **the target's own persisted `selectedModel` is never read** | job only | ignored | `delegate-to-workspace-root.ts:158-164` | read |
| `delegate-to-spawned` / `-agent` | same shape | same | same | ignored | `delegate-to-*.ts` | read |
| Channels / report-delivery global turn | **no** `permissionMode` field at all => bypass-w-gate; `autoContinue:false` only when `inboundAttribution` is set | `input.model` (unset in practice) | never passed | ignored | `run-global-root-turn.ts:391, 417` (grep: no `permissionMode`/`thinkingEffort`) | grep + read |
| Swap segment | copy-forward from predecessor (mode/model/effort/buildout + status trio) | yes | yes | yes | `record-swap-segment-session.ts:102-112`; `handle-session-started.ts:147-157` | read |
| Continuation turn | inherits the row's settings as resolved for the genuine turn (the closure's `turnSettings` is reused) | yes | yes | — | `chat-turn.ts:310-319` inside `startOneTurn` | read |
| Checkpoint follow-up job | the parent job's columns are copied by `enqueueFollowUpJob` | yes | yes | — | `enqueue-checkpoint-continuation.ts:124` | read |

**Gaps, ranked**

1. **G1 · P1 · no fit guard on delegated model picks.** `fitPinnedModelToSession` has exactly **one**
   caller in the whole repo (grep: `global-root-turn.ts:183`). A `send_message(..., model:'haiku')` onto a
   workspace primary sitting at 400 k tokens is byte-for-byte the 2026-08-19 voice incident, on a surface
   with less supervision. **[KNOWN residual -> CONFIRMED still open.]** Fix: call it in `delegate-to-*.ts`
   and in `session-turn.ts`.
2. **G2 · P1 · the voice mode split (B6).**
3. **G3 · P2 · a delegated turn ignores the target session's own persisted model/effort.** The user picked
   Fable for the Acme workspace; a delegated task there runs on the CLI default unless the *delegating
   model* happened to type a model id (`delegate-to-workspace-root.ts:163-164`). The mode is inherited from
   the parent by design; the model is inherited from nobody.
4. **G4 · P2 · spawned sessions born NULL** => a DM to a child of an *auto* parent defaults to `ask`.
   **[KNOWN residual -> CONFIRMED]**; B3 is the sharp edge of the same fact.
5. **G5 · P3 · `autoBuildout` is stored, copied forward, PATCHable, sent with every turn — and read by
   nothing.**
6. **G6 · P3 · effort never reaches channel/delivery turns** (`run-global-root-turn.ts` has no
   `thinkingEffort` field), so a Telegram turn always runs adaptive.

---

## 4. Places we missed that can be improved

- **I1 · The catch-up net has no second chance.** `surfacedToRootAt` is a one-way latch with no "delivered"
  confirmation. Beyond B1's fix, an invariant is missing: *nothing is marked surfaced until the turn that
  carries it has persisted its user row.* One helper, one call site.
- **I2 · Five process-wide registers, one restart story, no shared home.** `pending-checkpoints.ts:28-29,97`,
  `swapping-primaries.ts:10`, `root-turn-lock.ts:18`, `session-target-locks.ts:22`,
  `delegation-cancel-registry`. Each is documented as Phase-1 and honest in isolation, but nothing says
  *"these five die together at restart, and here is what each degrades to."* A short
  `docs/module-notes/process-state.md` (or one barrel with the boot reconciliation each needs) would make
  the Phase-2 swap mechanical instead of five separate decisions.
- **I3 · No lease anywhere.** `claimedAt` (S2), `session_turns.startedAt`, and both lock maps all encode
  "held since" and none is ever compared against now outside boot. One periodic sweeper keyed on
  budget + slack closes S1, S2 and half of S3.
- **I4 · One measurement column, shared by every runner.** `chat_sessions.model` is "the last model that
  ran" (`handle-usage-reported.ts:58-62`) and is *also* the pressure denominator
  (`apply-primary-turn-continuity.ts:126-127`) and the fit guard's input
  (`fit-pinned-model-to-session.ts:63`). A single delegated turn on a small model rewrites the pressure
  denominator of a session the user drives on a 1 M model. It has not bitten because a small model resuming
  a big session fails first — i.e. G1 is currently masking I4. Worth a `lastContextWindow` column, or
  measuring against `selectedModel` when the row has one.
- **I5 · Swap observability is write-only.** `session.swapping` / `swapped` / `swap-aborted` are emitted and
  consumed by the UI, but nothing counts them. A swap that aborts on the carry-fidelity floor
  (`bridge-primary-session.ts:166-182`) logs a warn and is invisible thereafter, and the same session will
  re-attempt every turn. `swapAttempts` / `lastSwapAbortedReason` on the primary row (or a metric) turns
  "the brain feels forgetful" into a number.
- **I6 · Tests defend the runners, not the seams.** `run-global-root-turn-core.test.ts` is genuinely good
  (real SQLite, fake provider, voice describe, checkpoint->continuation). What has no test: the *edge*
  composition — that a failed turn does not consume the catch-up net (B1), that a call-leg turn's mode is
  unattended (B3), that a timed-out delegation does not release its lock (B4). All three are `apps/` <->
  `packages/` seams, and all three are where the real bugs are.
- **I7 · `routes/root/index.ts` at 503 lines** violates the <=300 rule and mixes three concerns.
  **[KNOWN, recorded as next-touch]** — agreed, and the voice doors are the right cut (see §8).
- **I8 · A user-facing one:** the Voice chat panel renders the transcript, but the daemon's brain answers by
  **calling the `speak` tool**, not by writing prose (`voice-session-driver.ts:258-269`: *"'text' deltas are
  ignored — voice output is the `speak` tool alone"*). The typed transcript of a *spoken* turn can therefore
  read as a tool call with little assistant text. Worth checking in the live smoke.

---

## 5. Monitoring binding + node display

**My interpretation: both (a) and (b) are in scope, and I answer both.**

### (a) The Nodes constellation view

**The binding is honest; the inputs are not.** `resolveNodeStatus` (`composables/nodes/node-status.ts`) is a
*pure palette rename* of the real ladder — no invented states, pinned by `node-status.test.ts`.
`deriveSessionStatus` has exactly one call site (`use-session-statuses.ts:80`) and `deriveView` three (all
inside `use-workspace-status.ts`). That part is one truth and it is good.

What is wrong:

- **Fleet dots paint confident grey before the poll answers.** `use-fleet-nodes.ts:36` computes and returns
  `hasAnswered`; `NodesView.vue` consumes `hasAnswered` **only** for the project level (`:108`) — the
  fleet-empty gate at `:101` is `fleetNodes.nodes.value.length === 0` alone, so on every open all projects
  fall to `?? "not_running"` -> `idle` and the bar reads "N idle" for the whole poll flight. The
  composable's own docstring calls this *"the second, independent half of the recorded nodes bug (a claim
  made from data we did not have)"* — the guard was built and never wired. **P1, CONFIRMED.**
- **B8** (the 50-cap): the project level shows zero sessions past 50 conversations user-wide.
- **`NodesRace.vue:24`** kept a two-state label (`node.status === "building" ? "working" : "waiting to
  start"`) that the one-rule sweep fixed in `NodesGrid.vue:12-18` and `NodesFleetBar.vue:34-39`. A red node
  reads "waiting to start". **P2, CONFIRMED.**
- **B7** (index-keyed buffers), and `constellation-scene.ts:335` does `nodes.findIndex(...)` inside
  `anchorOf`, called twice per message per frame at 60 fps — O(nodes x messages).
- `NodesView.vue:247` promises "hover a node for details"; `hitTest` exists on the scene handle and is called
  from nowhere outside the scene's own mouse handlers. No tooltip exists.
- Two ladders on two polls for one room: "The build" dot reads `deriveView` off the 5 s
  `/workspaces/statuses` poll (`use-project-nodes.ts:62`) while its sibling dots read `deriveSessionStatus`
  off the turn-invalidated overview (`:74`). Deliberate (the continuing chain has no overview entry of its
  own) but they transiently disagree.

**Can it be ENLARGED? Not without a contained refactor first.** Three concrete blockers:

1. **Levels are hard-coded to two.** `NodesView.vue` carries one `drilledProjectId` ref + a boolean
   `isInsideProject` branching through five computeds (`displayNodes`, `sceneMessages`, `isFleetEmpty`,
   `isProjectEmpty`, `coreLabel`) plus `onNodeClick`. A third level (sessions -> agent runs -> tasks) touches
   all six.
2. **Node identity is string prefixes.** `continuing:${id}` / `session:${id}`, encoded in
   `use-project-nodes.ts:59,70` and `message-scene-mapping.ts:60-64`, decoded by `.startsWith("session:")` at
   `NodesView.vue:90-92`. A third kind means a third prefix in two more places.
3. **`SceneNode` is `{id, name, initials, status}`** (`constellation-scene.ts:19-25`) — no kind, no note, no
   counts. `deriveSessionStatus` already returns a `note` and `deriveView` already returns
   `tasksDone/tasksTotal`; both are discarded at the `resolveNodeStatus(...)` call sites.

**What to change:** a level *stack* (`Array<{kind, id}>`) replacing the boolean; a typed `SceneNode.kind`
replacing prefix parsing; widen `SceneNode` with the note/count fields the derivations already produce; key
the scene's scratch buffers by node id. The scene is otherwise fine for scale (no full rebuild — `setNodes`
swaps a reference and positions ease; `NodesGrid`/`NodesRace` are correctly `:key="node.id"`). The real
ceiling on node count today is the **data** cap (B8), not the canvas — though orbit layout runs off-viewport
past ~7 lanes (`constellation-scene.ts:214`).

### (b) The wider live-monitoring binding

**Liveness is genuinely single-sourced.** One user-wide activity channel over one socket per window;
`resetServerTurns()` fires on both `onDetached` and scope dispose (`use-session-activity-feed.ts:81,88`), so
a dropped socket cannot leave stale running entries. No double-derivation of status, no polling-vs-socket
fork.

**Coverage by scope:** global OK, workspace OK, spawned OK, agent OK (`AgentRunPane` reads `serverTurns` by
host session id) — **voice is half-integrated**, and that is the one real hole:
`SessionsOverviewEntry.scope` gained `'voice'` but `SessionTurnActivity.scopeKind` did not, so a voice turn
masquerades as a global turn on the one live channel every surface reads (B2 and its status sibling). The
voice *conversation* is correctly invisible everywhere else — `foldSessionChains` drops any chain hidden
end-to-end that is not scope `'global'` (`fold-session-chains.ts:69`), so the spoken thread never enters the
overview, the sessions library, `list_sessions`, or the sidebar. Deliberate and clean.

**Verdict:** the *derivations* are one truth; the *inputs* are not — one missing scope value on the feed
wire, and one shared 50-entry page doing duty as three different reads.

---

## 6. Session continuity everywhere

**Applied (verified by grep of every call site + read of each):**

| Runner | Pressure->swap | Carry | Checkpoint | Auto-continue | whoami / duty |
|---|---|---|---|---|---|
| Global web (`run-global-root-turn-core.ts:297`) | yes | yes | yes | in-stream (`:103`) | yes |
| Global channels / delivery (`run-global-root-turn.ts`) | yes (same core) | yes | yes | `autoContinue:false` for deliveries (`:417`) | yes |
| **Voice** (same core, `input.voice`) | yes | yes | yes | in-stream — but see V-c | yes (`duty-book` maps voice -> `duty-global-root`) |
| Workspace chat (`chat-turn.ts:360` -> `startChatTurn:250`) | yes | yes | yes | yes | yes |
| Spawned / agent DM (`session-turn.ts:369`) | yes | yes | yes | yes | yes |
| delegate-to-workspace-root / -spawned / -agent (`:234` / `:256` / `:221`) | yes | yes | yes | via follow-up job (`enqueue-checkpoint-continuation`) | yes |
| Agent-run job (`run-agent-run-job.ts:327`) | yes | yes | yes | yes | yes |
| Leaf session (`delegate-to-leaf-session.ts`) | by design none (one-shot, no identity) | — | the tool says so (`checkpoint-tool.ts:39-52`) | — | yes |
| Monitor / schedule / task wakes | yes — they enqueue into the same queues (`run-monitor-tick.ts:221,238`) and inherit the runners' continuity | yes | yes | yes | yes |

Coverage is complete. The gaps are in the *conditions*, not the placement:

- **C1 · P1 · The registers vs. the process.** `pendingByPrimaryId`, `continuationDepthByPrimaryId`,
  `continuationJobsById` (`pending-checkpoints.ts:28,29,97`) and `swappingPrimaryIds`
  (`swapping-primaries.ts:10`) are process-wide Maps. A restart between a checkpoint and its swap loses the
  checkpoint entirely: `buildContinuityContext` peeks it into the carry (`build-continuity-context.ts:133`)
  and the runner takes it — both gone. The tool call is on the chat row so the audit trail survives, but the
  *automatic* continuation does not. Documented as a deliberate v1 call; with the auto-continue arc shipped
  it is now the difference between "Vynel finished the job" and "Vynel stopped mid-task and said nothing."
  I would promote the durable column.
- **C2 · P1 · A mid-turn swap splits one turn across two segments.** `handle-session-started.ts:107-124`: on
  a resumed turn whose SDK id changed, the user row stays on the *predecessor* (`initialMessageCount: 0`) and
  the assistant's reply lands on the new segment. Chain-walking readers cope (`resolvePrimaryTranscript`); a
  reader that fetches ONE segment sees an answer with no question.
- **C3 · P2 · The pressure denominator can be written by someone else** — I4.
- **C4 · P2 · Global + voice now run concurrently and share a cwd.** `resolveVoiceConversationTarget` and
  `resolveGlobalRootConversationTarget` both return `resolveGlobalRootWorkspacePath()`
  (`resolve-global-root-conversation.ts:42,62`) while the lock keys differ (`run-global-root-turn-core.ts:93`).
  I swept for per-cwd mutable state and found none that matters (attachment bytes are per-session under
  `.vynel/transcripts/<sessionId>/`; `composeSessionCapabilities` is workspace-only and never runs on this
  path). The risk is **user-wide** state, and exactly one such thing exists — the catch-up collector — which
  voice correctly skips (`compose-global-root-provider-message.ts:40-43`). That call was right; B1 is the
  same collector's *other* failure mode.
- **C5 · P2 · The carry can silently lose its tail.** `readTail` budgets newest-first to 5 000 chars
  (`build-continuity-context.ts:74-75,156-161`) and `break`s on the first line that would overflow — so one
  600-char message truncates the tail early instead of being skipped. Small, but the tail is the half the
  distill cannot reconstruct.
- **C6 · P3 · Voice no-write vs. copy-forward.** The rule "voice turns never write settings" holds
  (`global-root-turn.ts:338-340`), but the panel PATCHes the row directly and the swap copies it forward
  (`record-swap-segment-session.ts:102-112`). Voice settings *are* durable and *are* carried — they are just
  only honoured half the time (B6). The two mechanisms are consistent; the read rule is not.
- **C7 · P3 · The continuation cap is per-process and per-identity, reset by any genuine turn.** A model that
  checkpoints on every user message runs up to 4 turns per message indefinitely. Bounded per message — worth
  a note, not a fix.

**Improvements, ranked:** (1) durable checkpoints (C1); (2) mark-surfaced only after the turn starts (B1);
(3) `lastContextWindow` on the segment so the denominator survives a foreign model (I4/C3); (4) fit-clamp
every pinned/delegated model, not just voice's (G1); (5) tail budgeting that skips rather than breaks (C5).

---

## 7. Score — **7 / 10**

| Axis | Score | Why |
|---|---|---|
| Correctness | 6 | The primitives are right and ownership gating is uniform. But B1 loses reports silently, B4 puts two writers on one session, and B2 can bind the global chat to the private voice thread. Three independent silent loss/leak classes is more than a 7 |
| Stuck-resistance | 6 | Retries, continuation depth, the priming drain and the approvals reaper are properly bounded. Nothing else is: no lease, no lock deadline, no mid-run reaper. Boot recovery is excellent and is the *only* recovery |
| Settings integrity | 6 | The `input ?? row ?? surface` spine is clean and swap copy-forward is right in both homes. Then: `autoBuildout` is bound nowhere, the model is inherited by nobody, one surface runs two modes, the fit guard has one caller |
| Observability | 8 | Feed + live channel + status ladder are genuinely one truth over one socket. Docked for the voice scope hole and for a swap that aborts invisibly |
| Continuity | 8 | Every runner is covered, uniformly, not bolted on — a real achievement. Docked for process-only checkpoints and the mid-turn split |
| Voice | 6 | The architecture is right (own identity, own lock, catch-up skipped, one pin home). The edges are unfinished: the call leg's mode, the feed's scope, the typed/spoken split |
| Tests | 7 | Real SQLite everywhere, no DB mocks, colocated, and the continuity tests are excellent. The `apps/` <-> `packages/` composition seams — where every P1 here lives — are untested |
| Code health | 9 | Genuinely unusual. Comments explain *why*, decisions carry their incident dates, one-home rules are stated and mostly kept. `routes/root/index.ts` at 503 lines is the visible exception |

**What moves it to 8:** fix B4 (lock lifetime follows the delegate promise), B1 (mark after the turn starts),
B2 (`scopeKind: 'voice'` on the wire), B3 (call leg sends an unattended mode). Four contained changes; none
needs a migration.

**What moves it to 10:** the four above, plus (i) a lease model — `claimedAt` read as a lease, a periodic
sweeper, a bounded `acquire()` — so "stuck" becomes a state the system detects instead of one a human
notices; (ii) durable checkpoints and a `lastContextWindow` column so continuity survives a restart and a
foreign model; (iii) one fit guard on *every* pinned model, with tests at the `apps/`<->`packages/` seam;
(iv) settings that mean one thing per conversation — `autoBuildout` bound or deleted, the target's model
honoured, one mode per thread.

---

## 8. The VOICE SESSION — review

### End-to-end trace (what I verified)

`main.ts` -> wake word -> `voice-session-driver.ts:263` `runBrainTurn(utterance)` ->
`run-brain-turn.ts:101-106` POSTs `/root/turn` with `{userMessageText, model: VOICE_TIER_MODEL,
thinkingEffort: 'low', voice: true}` -> `global-root-turn.ts:129-133` branches to
`resolveVoiceConversationTarget` -> `:150-155` **skips** the settings row read -> `:182-195` fit-clamps the
pin -> `run-global-root-turn-core.ts:93` locks `${userId}:voice` -> `:181` composes the provider message
with the **catch-up skipped** and the voice marker appended (`compose-global-root-provider-message.ts:40-50`)
-> `:279-282` `newSessionOptions` scope `'voice'`, hidden, `skipAutoTitle` -> `:297` boundary continuity ->
the reply. **Speech does not ride the SSE**: the brain calls the `speak` tool, which loops back to the daemon
(`voice-session-driver.ts:258-269`: *"'text' deltas are ignored — voice output is the `speak` tool alone"*),
queued behind the echo-defense state machine (`:157-190`).

**The design is right.** The three things that mattered are correct: the own identity, the own lock (so a
400 k global brain can no longer kill speech), and the catch-up skip (so a voice turn cannot steal the
global chat's reports — subtle, and they got it right). The pins have **one home**:
`packages/contracts/src/chat/voice-tier.ts:14-15`, imported by the daemon wake line
(`run-brain-turn.ts:51-54`), the call client (`call-session-client.ts:2`), the web overlay leg
(`use-voice-session.ts:5-6`) and the panel's composer defaults (`VoiceChatPanel.vue:19-22`). Four consumers,
zero drift. That is the section's headline question and the answer is **yes, one home**.

### Where it breaks — ranked

1. **V-a · P1 · the call leg runs in `ask` mode** — B3. The wake line is unattended-by-default and the call
   leg is `ask`-by-default, from the same daemon, purely because they post to different routes. The single
   worst thing in the voice arc.
2. **V-b · P1 · the voice/global wall is up on tools and routes and down on the live feed** — B2.
3. **V-c · P2 · the daemon stops reading at `session-completed`.** `run-brain-turn.ts:88`:
   `if (brainEvent?.kind === 'completed' || frame.event === 'turn-stream-ended') return`. The comment
   justifies it (the swap can take tens of seconds and voice has no chip for it) and it is the right call —
   but it means the daemon never observes `context-patching`/`patched` **or a checkpoint continuation**. The
   continuation's `speak` calls still reach the daemon through the tool loop, so speech is not lost; what is
   lost is the daemon's *state* — it has already reopened the mic and reset to idle while a continuation turn
   is still running server-side. That is the ingredient for a speak-arriving-while-listening race. Worth a
   live smoke with `VYNEL_CONTEXT_PRESSURE_THRESHOLD` forced low. I checked that the disconnect does **not**
   abandon the server-side swap: `hono@4.12.27`'s `StreamingApi.write()` swallows write errors, so the turn
   and its boundary step run to completion.
4. **V-d · P2 · voice notes to global are destroyed by a restart** — B5. `send_message to:"global"` enqueues
   a `note` row; a crash while it is `claimed` sets it `failed` **and** `surfacedToRootAt`, so the thought
   vanishes with no trace on either thread.
5. **V-e · P2 · the mode/model chips are honoured for typed turns and ignored for spoken ones** — B6. Two
   records disagree about whether that is intended; it needs Kafi's call.
6. **V-f · P3 · the fit clamp does not cover the turn's @mention dispatches** — B9.
7. **V-g · P3 · the fit clamp *does* cover a human's explicit model pick, silently** — B6b.
8. **V-h · P3 · a spoken turn's Voice-chat transcript may read as tool calls** — I8.

**Wall check — I enumerated the readers rather than re-confirming the three the doc names.** Fenced and
correct: `chat-search.ts:76` (`AND s.scope NOT IN ('global','voice')`), `routes/sessions/index.ts:251`
(`forbiddenScopes: fromGlobalRoot ? [] : ['global','voice']`), `turn-session-header.ts:59`
(`isTurnFromGlobalRoot` accepts both — the deliberate "one assistant, two areas" lift),
`fold-session-chains.ts:69` (a hidden-end-to-end non-global chain never becomes an entry, so voice never
reaches the overview / library / `list_sessions` / sidebar), `routes/sessions/index.ts:129-131` (the
`scope==='global'` list filter cannot reach voice for the same reason). The **fourth reader nobody fenced**
is the live activity feed (B2) — it is not a scope comparison, which is why the sweep missed it.

### Judging the recorded open forks

- **`direct_to_user` reaches only the global catch-up net** — *right to have named it, and now more urgent
  than recorded*, because B1 shows that net can be consumed by a turn that never ran. A voice-only user never
  hears a `direct_to_user` answer at all; worse, the row is marked surfaced by whichever global turn composes
  next. **Fix B1 first; the voice-absorption question is secondary.**
- **Voice-fired tasks parent on the global conversation** — *right call, leave it.* Reports landing in the
  global chat is coherent with "the voice area shows under Global", the ledger stays in one place, and
  re-plumbing would fork the report-delivery rail for one origin. The documented edge (routing from voice
  400s until the global thread has spoken once) is real and cheap to fix independently.
- **Split the voice doors out of `routes/root/index.ts` (503 lines)** — *right, and do it now*, not for the
  line count but because the two `/voice-chat/*` doors are the only owner-scoped, no-`x-mcp` routes in a file
  otherwise full of tool-exposed ones. Keeping them adjacent to `x-mcp` routes is how a wall gets
  accidentally opened.
- **Per-call sessions gain the routing toolset** — *not yet.* Give them a mode first (V-a). Adding
  `send_message` / delegation to a session that cards every mutating tool on a live phone call widens the
  stuck window; it does not improve the feature.

---

## Top 10 ranked

| # | ID | Sev | One line | Where | Conf |
|---|---|---|---|---|---|
| 1 | B4 / S1 | P1 | A timed-out delegated run releases its target lock while still streaming -> two writers on one primary | `run-delegation-claim-and-run-tick.ts:816-843` + `delegation-service.ts:203-224` | CONFIRMED |
| 2 | B1 | P1 | Catch-up reports marked surfaced before `startChatSession` -> a failed turn loses them forever | `compose-global-root-provider-message.ts:54` | REPRODUCED |
| 3 | B3 / V-a | P1 | Per-call voice session runs `ask` mode on a card-less surface; parks ~5 min per tool | `call-session-client.ts:32` -> `session-turn.ts:94` | CONFIRMED |
| 4 | B2 / V-b | P1 | Voice turns announce as `scopeKind:'global'` with no `primarySessionId` -> the Global chat can bind to the voice thread, stickily | `global-root-turn.ts:321` -> `activity-store.ts:61` -> `use-continuing-conversation.ts:68` | CONFIRMED |
| 5 | S2+S3+S4 | P1 | No lease, no lock deadline, no mid-run reaper: `claimedAt` never read, `acquire()` unbounded, `root-turn-lock` an untimed chain | `delegation-jobs.ts:193`, `session-target-locks.ts:34`, `root-turn-lock.ts:24` | CONFIRMED |
| 6 | G1 | P1 | `fitPinnedModelToSession` has ONE caller; a delegated small-model pick onto a fat primary is the same crash class | grep: `global-root-turn.ts:183` only | CONFIRMED |
| 7 | N1 | P1 | Fleet node dots paint confident grey before the status poll answers — the built `hasAnswered` guard is never wired | `use-fleet-nodes.ts:36` vs `NodesView.vue:101` | CONFIRMED |
| 8 | B5 / V-d | P2 | A restart destroys `direct-delivery` and `note` rows (incl. the voice->global note rail) | `delegation-jobs.ts:567` | CONFIRMED |
| 9 | B6 / V-e | P2 | One voice thread, two permission modes and two models — typed vs spoken | `use-chat-turn.ts:178` + `use-session-settings.ts:92` vs `global-root-turn.ts:150` | CONFIRMED |
| 10 | C1 | P2 | Checkpoints, depth and swap marks are process-only: a restart mid-checkpoint silently ends the work | `pending-checkpoints.ts:28-29,97` | CONFIRMED |

**Score: 7/10.**
