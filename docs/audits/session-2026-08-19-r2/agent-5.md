# Session system audit — round 2, agent 5 (monitoring/UI entry point)

Worktree `feature/session-audit` @ `71dbe151` (main, the session-hardening merge). Entry point per
brief: `match-turn-to-identity` → every consumer → voice status → Nodes → live channel → back into
the server truths those bind to → then widened to delegation, streams, continuity, voice daemon.

**Method note.** I did NOT start from round-1's P1 list. I turned `session-hardening.md` §6 + §7 into a
checklist of individual *hand-off* claims (things a slice could not write itself and the lead claims to
have folded) and verified each in code — that hand-off is where a seven-way merge loses things, and
round-1 P1 closure falls out of it. One finding (A5-01) was reproduced by a throwaway vitest, run and
deleted. Everything else is traced hop-by-hop with `path:line`.

Legend: `CONFIRMED` = traced end-to-end in this checkout or reproduced. `PLAUSIBLE` = reasoned from
code but a live condition I could not force.

---

## 0. §6/§7 hand-off verification (the pass everything else hangs off)

| Claim (§6/§7) | Verdict | Evidence |
|---|---|---|
| B ask #1 — `autoBuildout` spread into `startChatTurn` at both stream call sites | **DONE** | `streams/chat-turn.ts:331-333`, `streams/session-turn.ts:347-349`; also `global-root-turn.ts:437-439` → core `run-global-root-turn-core.ts:189`. Channels resolve it too (`sessions/run-global-root-turn.ts:283,448`). |
| G-1 — 13 db-first edits at every checkpoint-register caller | **DONE** | `pending-checkpoints.ts` is fully `db`-first; `run-turn-with-continuations.ts:78-133`, `run-report-delivery-tick.ts:504-506`, `build-continuity-context.ts:133`, `checkpoint-tool.ts:62` all pass `db`. |
| G-3 — the report tick's stray-checkpoint drop is survivor-safe | **DONE** | `run-report-delivery-tick.ts:498-512` captures `notifyTurnStartedAt` and drops only `pending.checkpointedAt >= notifyTurnStartedAt`. |
| Reviewer must-fix #1 — the channel/delivery global runner stamps `primarySessionId` | **DONE** | `sessions/run-global-root-turn.ts:404-410`. **(This is also the cause of A5-01 below.)** |
| Reviewer must-fix #2 — a voice-surface Stop with no known session sends nothing | **DONE, but see A5-02** | `use-chat-turn.ts:312`. It never hits the global head — but the Voice panel now has no Stop at all for a daemon-driven turn. |
| Reviewer must-fix #3 — terminal delegation writes are a CAS on the claim | **DONE** | `delegation-jobs.ts:299-317` (complete), `:319-341` (fail), `:349-375` (requeue, `claimed|pending`). |
| E3 coupled pair — daemon publishes handed-off speak **and** the overlay skips its own live turn | **DONE (both halves)** | `apps/voice/src/main.ts:155-163`; `use-voice-daemon-link.ts:40,79`; passed by `VoiceOverlay.vue:23` and `JarvisView.vue:30`. |
| `getVoiceChatOverviewEntry` "newest voice chain" is safe | **DONE** | Partial-unique index exists: `primary-sessions.ts:127` `uniq_primary_sessions_voice_user`. |
| G-4 / G-6 — whoami + the overview meter read the persisted denominator | **DONE** | `resolve-whoami-report.ts:126` (`resolveSegmentContextWindow`), `compose-overview-entry.ts:137` (`tail.lastContextWindow ?? resolveContextWindow(model)`). |
| G-8 — the dropped-checkpoint note row lives in `chat/records` | **DONE** | `chat/records/record-system-note-message.ts`, called from `continuity/drop-pending-checkpoint.ts:97`. |
| A3c — the delivery job id IS the inbound row id; every user-row write is find-or-insert | **DONE** | `insertChatMessageIfAbsent` at `consume-session-event-stream.ts:157`, `handle-session-started.ts:164,209`; `inboundMessageId: claimed.id` at `run-report-delivery-tick.ts:468`. |
| `segmentSessionIds` on both continuing payloads from one chain reader | **DONE** | `routes/chat/index.ts:185-186` + `routes/root/index.ts:90-91` → `listSessionChainSegmentIds`; consumed at `use-project-nodes.ts:155`. |
| Global delivery yields its pool slot while the root lock is busy | **DONE** | `run-report-delivery-tick.ts:279-291`. |
| D5 — `/activity/running` removed | **DONE** (route gone). `listRunningSessionTurnsForUser` (`repositories/session-turns.ts:67`) is now a dead export — §6 flagged it, nobody removed it. |
| B ask #5 — leaf sessions still born with NULL settings | **STILL OPEN** (deliberately) | `chat/records/record-leaf-session.ts:48-66` writes no settings columns. |
| §7 deferred: `EnqueueAgentRunInput.origin`, leaf `bypass-with-behavior-gate`, live frame for the dropped note, `useMessageEdges` poll, Nodes visual redesign | **STILL OPEN** (recorded) | as documented. |

**The one hand-off that produced a regression:** must-fix #1 + C3's `primarySessionId` stamping changed
the shipped wire for *every* global turn. Six readers were updated for it (`activity-store`,
`use-session-statuses`, `use-continuing-conversation`, `VoiceChatPanel`, `desktop-activity-fold`,
`TasksPanel`). **`use-working-rail.ts` was not** — and its test constructs the pre-arc wire, so it
stays green. That is A5-01.

---

## 1. Bugs — all scopes

### NEW

**A5-01 · P2 · global · voice · channels · monitoring · The working rail lost the brain: every global
and voice turn now rails as a nameless "Working…" session chip, and the voice chip opens the spoken
thread**
`apps/local-web/src/composables/activity/use-working-rail.ts:128` vs `:150`;
`apps/local-web/src/components/rail/WorkingRail.vue:33,57`

```ts
// use-working-rail.ts:127-150
for (const turn of serverTurns) {
  if (turn.primarySessionId != null) {          // NOW TRUE FOR EVERY GLOBAL/VOICE TURN
    upsert({ kind: "session", key: `session:${turn.primarySessionId}`,
             label: turn.personaName ?? "", segmentId: turn.sessionId ?? null, ... })
  } else if (turn.scopeKind === "workspace" && turn.workspaceId != null) { ... }
  else if (turn.origin !== "web") {             // the "brain" chip — now UNREACHABLE for global turns
    upsert({ kind: "brain", key: "brain", label: "Claude", ... })
  }
}
```

Hop-by-hop: (1) `sessions/run-global-root-turn.ts:404-410` and `streams/global-root-turn.ts:334-339`
now stamp `primarySessionId` on **every** global and voice `activityFeed.begin` (must-fix #1 + C3);
(2) `session-activity-feed.ts:109` puts it on `SessionTurnActivity`; (3) `activity-store.ts:101-104`
folds `turn-started` verbatim; (4) the rail's first branch wins. Consequences:
- A Telegram/Discord reply, a schedule-fired brain turn, a delivery notify turn and the user's own web
  global turn all rail as `kind:"session"` with `label:""` → `WorkingRail.vue:33` renders **"Working…"**.
  The "Claude" brain chip no longer exists in practice.
- The file's own spec comment ("the user's own web turn is the thread you're already looking at, so it
  never rails") is now false — a web global turn rails.
- Clicking → `WorkingRail.vue:57` `sidebar.openSession({ sessionId: <the global brain's hidden segment> })`
  instead of routing to the global chat (`openEntity`'s `brain` branch at `:49`).
- **Voice**: a spoken turn rails as `session:<voicePrimaryId>` with `segmentId` = the voice segment.
  Clicking opens the *spoken thread's hidden segment* in the ordinary conversation sidebar
  (`GET /root/sessions/:id`, `routes/root/index.ts:132-154`, is owner-gated only — no scope wall), so
  the private voice conversation renders as a normal conversation. Pre-arc the voice turn carried no
  primary id and fell to the brain chip, so this door did not exist.

The colocated test defends the pre-arc wire: `use-working-rail.test.ts:52,54` build global turns with
**no** `primarySessionId`. **CONFIRMED — reproduced** with a throwaway vitest
(`audit-r2-agent-5-rail.test.ts`, 3/3 green, since deleted): a `{scopeKind:'global', origin:'telegram',
primarySessionId:'p'}` turn yields `[["session","session:p",""]]`; a voice turn yields a session chip
with `segmentId` = the voice segment.
**Minimal fix:** key the rail on identity like every other reader — take the brain branch when
`matchTurnToIdentity(turn,{kind:'global'})` **and** `turn.primarySessionId === rootSessionId`, exclude
`scopeKind === 'voice'` entirely (the rail cannot open it — same reasoning as `TasksPanel.vue:97-102`),
and update `use-working-rail.test.ts` to the post-arc wire.

**A5-02 · P2 · voice · The Voice chat panel cannot Stop a daemon-driven turn — the button is not even
rendered**
`VoiceChatPanel.vue:218,222` · `use-chat-turn.ts:312` · `packages/ui/.../ChatComposer.vue:425`

The panel passes `:streaming="turn.isStreaming.value"` — its **own** engine only — while
`GlobalChatView.vue:483` passes `isTurnStreaming` = own ∪ watched. `ChatComposer.vue:425` gates the Stop
button on `v-if="props.streaming"`. So while the daemon drives a wake turn (rendered here through
`useWatchedTurn`), no Stop control exists. Even if it did, `use-chat-turn.ts:312`
(`if (options.voice === true && sessionId === null) return`) would send nothing, because
`activeSessionId` is null for a watched turn and `AppComposer` emits `interrupt: []` with no payload
(`AppComposer.vue:99`) so `displayedSessionId` is always `null`. The panel *knows* the id
(`headSessionId`, `:85-87`) and the server door accepts it (`routes/root/interrupt.ts:60-73`).
Round-1 V4 ("Stop reaches the global thread") is closed; "Stop on both threads" (Kafi's smoke) is not.
**Fix:** `:streaming="turn.isStreaming.value || watchedTurn.view.value !== null"` and
`@interrupt="() => turn.interrupt(headSessionId)"`. **CONFIRMED.**

**A5-03 · P2 · voice (call) · The call watchdog never aborts its read, so a late reply collides with the
next turn's speech and one of the two lines is silently dropped**
`apps/voice/src/call/call-conversation.ts:226` · `packages/voice/src/relay/line-speaker.ts:52-54` ·
`call-conversation.ts:287-299`

`runCallTurn(sessionId, utterance)` is called **without** the watchdog's `AbortSignal` — unlike the wake
leg (`run-brain-turn.ts:178-189` passes `signal`). After the watchdog fires (`:213-225`) the room is
handed back and the SSE read keeps running. Two collisions follow:
1. the watchdog's own `await this.#speak(CALL_TURN_STILL_WORKING_LINE)` can race the turn's
   `await this.#speak(spoken)` at `:247`;
2. a new utterance starts turn 2 (`#handleTranscript:158-161`) while turn 1's read is live; turn 1's late
   reply then speaks concurrently with turn 2's.

`LineSpeaker.speakLine` **throws** on re-entry (`line-speaker.ts:52-54` — "the caller must serialize
speech"); `#speak` catches it and logs `'call speech failed — the line was not heard'` (`:296-301`). On a
live call the participant hears "Still working on that" and then silence, or loses one of two answers.
The wake leg is safe — it routes every notice through the serialized `#speakQueue`
(`voice-session-driver.ts:112-136`). **CONFIRMED** by code trace (throw + catch are both explicit).
**Fix:** pass the watchdog signal into `runCallTurn` (the wake leg's shape) *or* serialize `#speak`
behind a promise chain and drop a superseded turn's reply.

**A5-04 · P2 · global · channels · A CHANNEL global turn has no wall clock and no cap — it can hold the
`${userId}` root lock forever**
`apps/local-api/src/sessions/run-global-root-turn.ts` (no `startTurnWallClock` anywhere in the file) ·
`services/channels-service.ts:90` · `runtime/root-turn-lock.ts:41-57` ·
`providers/.../run-claude-chat-session.ts:178-196`

C4 gave the wall clock to the three **interactive** streams only. The background global runner gets a
bound solely when it is wrapped by `buildGlobalRootReportTurnRunner` → `routeRequest`'s hard cap
(`run-report-delivery-tick.ts:349-385`). The **channel** caller (`channels-service.ts:88-102`) wraps it
in nothing. The provider bounds only *startup* (`run-claude-chat-session.ts:178-196`,
`provider_start_timeout`); the mid-stream `while (true) { await queryInstance.next() }` at `:276-341` is
unbounded. So a hung Telegram/Discord turn holds the `${userId}` root lock for the process lifetime →
every interactive global turn parks (`run-global-root-turn-core.ts:96`), and every global report/note
delivery re-yields its slot every 5 s forever (`run-report-delivery-tick.ts:279-291`) instead of failing.
That is round-1's **G1 cascade, half-closed**: the *interactive* trigger is bounded, the *channel*
trigger is not. **CONFIRMED** (absence verified by grep; the lock and the provider loop traced).
**Fix:** one line — arm `startTurnWallClock` in `runGlobalRootTurn` the way the streams do (it already
owns a `waitGate` for the delivery path at `:538-553`; give the plain channel path its own).

**A5-05 · P2 · schedules · A fired schedule runs `bypass-with-behavior-gate` (the floor still cards) with
no turn bound, no target lock and no settings resolution**
`packages/schedules/src/firing/fire-schedule.ts:139` ·
`providers/.../tool-approval-policy.ts:106-108` · `sessions/build-schedule-fire-deps.ts:54-88`

D3 made `auto` the one default and §2 says "`bypass-with-behavior-gate` stops being a fallback
anywhere"; schedules still hardcode it (`// D10`). Under that mode `decideCanUseTool` returns `'card'`
for the static floor (Bash/Write/Edit/NotebookEdit — `tool-approval-policy.ts:106-108`), so an
unattended fired turn parks on a card for ~10 min (the approvals reaper) per floor tool call — with no
turn-level clock at all (the fire path composes no `startTurnWallClock`) and no `SessionTargetLocks`
acquisition. The lock omission is harmless *today* only because schedules always start a fresh session
(`fire-schedule.ts:130`); the day a schedule resumes a room's primary, it becomes a second writer.
Schedules also resolve **no** mode/model/effort/autoBuildout from anywhere — §6 flagged "channels +
schedule fires resolve it nowhere"; channels were fixed (`run-global-root-turn.ts:262-283`), schedules
were not. **CONFIRMED.**

**A5-06 · P3 · global · The Global chat polls its transcript while only the VOICE thread is running**
`views/GlobalChatView.vue:211-217`

`hasUnrenderedGlobalTurn` reads `activity.hasGlobalServerTurn`, which is the **area** predicate
(`activity-store.ts:34-36` → `isTurnInGlobalArea` = global ∪ voice). A spoken turn therefore starts a
4 s poll of the *typed* thread's transcript. No binding, no status, no leak — just the family-vs-identity
distinction D1 drew leaking back in one place. **CONFIRMED.** Fix: `matchTurnToIdentity(turn,
{kind:'primary', primarySessionId: rootSessionId})` (the id is already in the continuing payload).

**A5-07 · P3 · delivery · `run-report-delivery-tick.ts:252-262` — the DIRECT-delivery ping begins with
`scopeKind:'global'` and no `primarySessionId`, violating the arc's own "identity on every begin"**
It is a `begin().end()` blip so nothing binds to it, but it is the one remaining begin site that would
now reach the rail's brain branch and the only counter-example to §4's stated invariant. **CONFIRMED**,
cosmetic.

**A5-08 · P3 · orchestration · A run whose heartbeat starves for 3 min is failed by the sweeper while it
is still alive; its later completion CAS-stands-down and the user keeps a false failure notice**
`delegation-lease-heartbeat.ts:24-39` · `services/delegation-orphan-settlement.ts:38-61` ·
`delegation-jobs.ts:299-317`

The CAS (must-fix #3) makes this *safe* — no double-write, no lost lock — but the honest failure
delivery has already been pushed. Needs 3 min of loop starvation against a 30 s beat, so low
probability; recorded because the sweeper has no "is this key held in-process" check
(`targetLocks.busyKeys()` is right there in `delegation-service.ts:169`). **PLAUSIBLE.**

**A5-09 · P3 · voice · `streamTurnEvents` reports a turn that ended with only `turn-stream-ended` as
`completed`** `apps/voice/src/brain/run-brain-turn.ts:137,162-164`
A stream that carries no `session-completed` and no recoverable failure still yields `{kind:'completed'}`,
so the daemon returns to listening believing success. Silent, not wrong-spoken. **CONFIRMED.**

**A5-10 · P3 · web · A relayed `speak` that lands just after the overlay's own turn settles double-plays**
`use-voice-daemon-link.ts:79` skips relayed speak only while `isPlayingOwnTurn()` (`voice.isActive`) is
true; the overlay's own adapter player (`use-voice-session.ts:96`) already played it. A relay arriving
after `isActive` flips false plays the same line a second time. Push latency-dependent. **PLAUSIBLE.**

### Verified clean (I probed these and found no defect)

- Every `activityFeed.begin` site's identity stamp is now consistent for the readers that bind:
  `chat-turn.ts:431-437` (workspace, no primary — the `{kind:'workspace'}` predicate depends on that
  absence and it holds), `session-turn.ts:447-457` (global/workspace + own primary),
  `run-task-job.ts:157-174`, `run-agent-run-job.ts:118-132`, `run-report-delivery-tick.ts:318-332`
  (workspace notify, no primary — correct, it runs on the room's primary),
  `build-schedule-fire-deps.ts:55-65` (workspace, no primary — correct; schedules can only be
  workspace-scoped and always start fresh, `fire-schedule.ts:130`).
- The voice wall on the *list* surfaces: `getSessionsOverview` / `countSessionsOverview` both route
  through `listableChains` (`get-sessions-overview.ts:44-47`), and those are the only two callers of
  `foldSessionChains` besides `getVoiceChatOverviewEntry`. `list_sessions` cannot see voice.
- `updateChatSessionSettings` 403s a `voice`-scope row, empty patch included
  (`update-chat-session-settings.ts:44-48`).
- Voice never reads or writes its row on either leg (`global-root-turn.ts:357-359`,
  `session-turn.ts:303`).
- `run-turn-with-continuations.ts:79-97` — the survivor/stray split is correct for both `autoContinue`
  values and the `finally` drop cannot eat a survivor.
- `SessionTargetLocks` FIFO + idempotent release (`session-target-locks.ts:47-59`); `chat-turn.ts:530-560`
  releases on every exit including a composition throw.

---

## 2. Stuck points

| # | Stuck point | How | Bound / owner today | Verdict |
|---|---|---|---|---|
| 1 | Interactive turn (global / voice / workspace / spawned DM) hangs | provider mid-stream await, parked card, parked ask | `VYNEL_INTERACTIVE_TURN_MAX_MS` 60 min, suspended while parked (`turn-wall-clock.ts:46-65`, armed in-lock at `global-root-turn.ts:417-422`, `chat-turn.ts:402`, `session-turn.ts:419`) → failure row + interrupt | **CLOSED** |
| 2 | Delegated run hangs | any | `VYNEL_DELEGATED_TURN_MAX_MS` 60 min via `routeRequest` (`route-request.ts:101-120`), cancel lever interrupts, envelope awaits the delegate; lock released only on settle | **CLOSED** |
| 3 | Crashed/wedged claim holds its row | process death, starved loop | claim lease + 30 s heartbeat + 60 s sweeper (`delegation-service.ts:133-139`), by kind (`delegation-orphan-settlement.ts`) | **CLOSED** |
| 4 | Orphaned `ask_user` row | waiter died before parking | 60 s reaper at `VYNEL_INTERACTIVE_ASK_MAX_MS` (`asks-recovery-service.ts`) + per-turn `cancelForTurn` in every stream's finally | **CLOSED** |
| 5 | Voice daemon deaf on a long turn | server turn outlasts the room | `armTurnWatchdog` 5 min → speaks + hands back + aborts the read (`voice-session-driver.ts:259-287`), plus a 10 s connect deadline (`run-brain-turn.ts:68,92-95`) | **CLOSED** |
| 6 | Second global/voice turn looks frozen | root lock queue | `turn-queued{busy|context-patching}` (`global-root-turn.ts:401-406`), spoken as "One moment" (`voice-session-driver.ts:297-302`) | **CLOSED** |
| 7 | Global delivery burns a pool slot behind the root lock | root lock busy | yields the slot, due in 5 s, no attempt spent (`run-report-delivery-tick.ts:279-291`) | **CLOSED** |
| 8 | **Channel global turn wedges the root lock** | hung provider stream; no clock | **none** — recovery is an api restart | **A5-04, OPEN** |
| 9 | **Fired schedule parks on a floor card / hangs** | `bypass-with-behavior-gate` floor + no turn clock | the approvals reaper (~10 min) per card; the turn itself unbounded | **A5-05, OPEN** |
| 10 | `SessionTargetLocks.acquire` is an uncancellable await | a queued user turn parks behind a holder | no deadline (`session-target-locks.ts:28-35`) — mitigated only because every holder now has a cap; a client disconnect does not cancel, and the turn then runs into a dead stream | **PARTIAL** |
| 11 | A spawned-session DM turn cannot be stopped | `useSessionTurn` aborts the client only (`use-session-turn.ts:37-42` — "client abort only — the server turn runs on"); there is **no** `/sessions/:id/turn/interrupt` route and `interrupt.ts:34` admits only `global|voice` | bounded at 60 min by the wall clock; no user-facing owner | **PARTIAL** |
| 12 | Voice panel Stop on a daemon turn | button not rendered; guard returns early | none | **A5-02, OPEN** |
| 13 | Call leg: late reply vs new turn | no abort on the watchdog | one line silently dropped | **A5-03, OPEN** |
| 14 | Restart mid-checkpoint | durable register on `primary_sessions`; `beginGenuineTurn` returns the survivor and leaves it in place (`pending-checkpoints.ts:128-134`), the loop continues it after the genuine turn | — | **CLOSED** |

One latent hazard worth naming: `ApprovalWaitGate.onParkedChange` is **single-subscriber** and
overwrites (`approval-wait-gate.ts:32-36`). Today exactly one `startPausableTimeout` registers per gate
(streams: the wall clock; delegation: `routeRequest`), so it is correct — but the next consumer that
attaches a second pausable timeout to the same gate will silently un-suspend the first, and nothing
would fail loudly. A one-line `throw`/array would make that a build-time fact. **P3.**

---

## 3. Modes / models / effort / autoBuildout — binding + inheritance

`DEFAULT_SESSION_MODE = 'auto'` (`packages/session/src/session-mode.ts`), reached through
`toPermissionMode(DEFAULT_SESSION_MODE)` at every fallback. `bypass-with-behavior-gate` is now reached
by exactly two deliberate paths (leaves, schedules).

| Path | mode | model | effort | autoBuildout | Source of truth | Verified by |
|---|---|---|---|---|---|---|
| Global web | `input ?? row ?? auto` | `input ?? row` | `input ?? row` | `input ?? row` → marker | `interactive-turn-settings.ts:66-76` | `global-root-turn.ts:168-183,437-439` |
| Voice — wake / overlay / panel | **`auto` forced** | **tier + fit clamp** | **`low` forced** | **undefined (no chips)** | `resolveVoiceTierSettings` `:78-104` | `global-root-turn.ts:146,336-338,444-446`; no row read/write `:357` |
| Voice — CALL leg | **`auto` forced** | **tier + fit clamp** | **`low` forced** | — | same resolver via `input.voice` | `session-turn.ts:105-112,303`; daemon sends it too (`call-session-client.ts:43-49`) |
| Workspace chat | `input ?? row ?? auto` | ✓ | ✓ | ✓ | same resolver | `chat-turn.ts:331-333` |
| Spawned / agent DM | `input ?? row ?? auto` | ✓ | ✓ | ✓ | same resolver | `session-turn.ts:347-349` |
| **Spawned-session BIRTH** | creator's row | ✓ | ✓ | ✓ | ambient turn-session header | `routes/sessions/index.ts:82-105` (`readCreatorSessionSettings`) |
| Leaf session birth | — | — | — | — | **NULL** (deferred) | `record-leaf-session.ts:48-66` |
| Delegation enqueue → job | `x-vynel-delegation-mode` (all four writers) | tool arg | tool arg | **no column** | `delegation-mode-header.ts:16-40` | — |
| delegate-to-* / task / agent-run / delivery | `job ?? target row ?? auto` | `job ?? agent.model ?? row`, **fit-clamped** | `job ?? row` | **target row only** | `resolve-background-turn-settings.ts:57-102` | `run-task-job`, `run-agent-run-job:301`, `run-report-delivery-tick:460` |
| Agent-run job | ✓ | ✓ | **carried now** (`enqueue-agent-run.ts:60,106`) | target row | — | T3 closed for effort; **origin still null** (§7 deferred) |
| Channels (Telegram etc.) | `row ?? auto` | `row`, fit-clamped | `row` | `row` | `sessions/run-global-root-turn.ts:262-283` | ✓ |
| **Schedules** | **hardcoded `bypass-with-behavior-gate`** | none | none | none | `fire-schedule.ts:139` | **A5-05** |
| Swap segment | copy-forward all four | ✓ | ✓ | ✓ | predecessor | `record-swap-segment-session.ts:107`, `handle-session-started.ts:154` |
| Continuation (interactive) | pinned to the checkpointing turn | ✓ | ✓ | ✓ | settled, unchanged | — |

**Gaps ranked:** A5-05 (schedules) → leaf NULL rows (row hygiene only; A5's resolver makes behaviour
correct) → **`autoBuildout` does not ride the delegation header**, so an autopilot global brain
delegating into a room runs that routed turn without the marker unless the *room's* row has it
(`resolve-background-turn-settings.ts:100` reads `row?.autoBuildout` and `delegation_jobs` has no such
column). That is consistent with the locked "`tool arg ?? target row ?? default`" rule but *not* with
D8's "inherited by children (D4)" — worth a one-line ruling rather than a fix. → `EnqueueAgentRunInput.origin`.

Everything else in this table is implemented consistently with the locked decisions. The fit guard
(round-1 M1) now runs on **every** background pick, the channel pick and both voice legs
(`resolve-background-turn-settings.ts:76-94`, `run-global-root-turn.ts:269-282`,
`interactive-turn-settings.ts:84-97`).

---

## 4. Missed improvements

1. **The stamp changed the wire; only six of seven readers were swept.** A5-01 is the proof. The arc
   added `matchTurnToIdentity` as the single predicate but did not make it *mandatory* — nothing stops a
   reader from touching `turn.primarySessionId` / `turn.scopeKind` directly, and `use-working-rail.ts`
   still does. A census test in the spirit of `continuity-census.test.ts` ("no file under
   `apps/local-web/src` reads `.scopeKind` or `.primarySessionId` off a `SessionTurnActivity` except
   `match-turn-to-identity.ts`") would have caught it at merge and is ~30 lines.
2. **Tests that construct the wire by hand are the arc's blind spot.** `use-working-rail.test.ts:52,54`
   builds turns from a shape that no longer ships. A shared `sessionTurnActivityFixture()` in
   `@vynel/contracts` test-support, used by every web fold test, would make the wire change a compile
   error instead of a silent pass.
3. **`GET /sessions/:id/children` ships with no consumer** (`routes/sessions/index.ts:586-616`; the
   Nodes registry is `{root, workspace}` only, `NodesView.vue:111-114`). The route, the contract, the
   repo read and the orchestration export all landed for a level nobody renders. Either land
   `useSessionNodes()` (the composable contract at `node-level.ts:24-32` says it is one file + one
   registry line) or mark the route provisional — a live door with zero callers rots.
4. **`listRunningSessionTurnsForUser` is dead** (`repositories/session-turns.ts:67`) — §6 named it, the
   merge kept it. Delete with its runtime re-export.
5. **Two chain-walk homes.** `listSessionChainSegmentIds` (`list-session-children.ts:165-202`) and
   `foldSessionChains` (`fold-session-chains.ts:38-93`) implement the same first-write-wins walk with
   the same corruption rule. F named it; `resolveChainSegments(rows, id)` is the landing.
6. **`ApprovalWaitGate` single-subscriber is a footgun** (§2 tail).
7. **The SDK's `system/api_retry` frames are still not surfaced** — a 100 s provider retry reads as idle
   on every surface. Round-1 §5b named it; it was out of the arc's scope and is still open.
8. **No live frame for the dropped-checkpoint note** (§7 deferred) — the row lands
   (`drop-pending-checkpoint.ts:97`) and a client sees it only on the next refetch. For "Vynel stopped
   mid-task and said so", the *saying* is the point.
9. **`sidebar.openSession` has no scope guard.** `GET /root/sessions/:id` (`routes/root/index.ts:132-154`)
   is owner-gated only; every UI path that mints a session id from the feed can now open a voice segment
   in a normal conversation pane. One `scope !== 'voice'` check at the store or the route would make the
   wall structural instead of "no reader happens to do it" (A5-01 shows a reader now does).

---

## 5. Monitoring binding + node display

### (a) The Nodes screen

**Bindings are honest and the round-1 bugs are closed.**
- Project level reads a **scoped** server page (`use-project-nodes.ts:40-55`, `scope: 'workspace'`) —
  N1 closed.
- `hasAnswered` is wired at **both** levels and consumed (`use-fleet-nodes.ts:77-84`,
  `use-project-nodes.ts:137-141`, `NodesView.vue:128-138`, `NodesFleetBar :has-answered`) — N2 closed;
  an errored poll counts as answered so one broken endpoint cannot withhold the fleet forever.
- Scene scratch is **id-keyed** and reconciled per `setNodes` (`constellation-scene.ts:194-207,825-868`),
  positions are copied not aliased, hover is re-mapped — N3 closed. `anchorOf` is an O(1) map read
  (`:392-397`) instead of a per-frame `findIndex`.
- Statuses are the real ladders: fleet = `use-workspace-status`, project sessions =
  `deriveSessionStatus` over the level's **own** entries (`use-project-nodes.ts:82`), the build = the
  room's ladder with its over-claim documented at `:96-102`. Nothing is invented.
- Arcs map the whole segment set on both sides (`use-project-nodes.ts:147-162`, using
  `segmentSessionIds` for the hidden build chain).

**Enlargeability is now structural** — `SceneNodeRef` is a discriminated union minted/parsed in ONE
place (`constellation-node-ref.ts:19-62`), the level stack replaced the boolean
(`node-level.ts:34-79`, `NodesView.vue:68-116`), `SceneNode.detail` carries note/tasks
(`constellation-scene.ts:42-50`), layouts are count-aware, and `GET /sessions/:id/children` exists.

**What still blocks more levels / nodes / info** (all UI work, none structural):
1. No third-level composable — the children route has no consumer (improvement 3 above).
2. **No Global node and no Voice node anywhere.** `parentSceneNodeKind` records "voice is a child of
   global" (`constellation-node-ref.ts:81-83`) and `SCENE_NODE_KINDS` includes both, but no level mints
   them, and `listSessionChildren` has no voice/global branch either — so D7's "voice is a CHILD of
   global **in the model**" is realised as a helper function, not as data. The fleet level draws
   workspaces only (`use-fleet-nodes.ts:36-59`), so the assistant itself is invisible on the screen that
   claims to show "everything Vynel looks after".
3. `detail` is carried and never rendered (deliberate — D7 defers the tooltip).
4. Inside a project every dot opens the room's chat (`NodesView.vue:106`), so a session node cannot open
   its own thread — fine as a locked meaning, but it caps what a third level can mean.

### (b) The wider live binding

**One pipe, and after the arc one vocabulary.** `SessionActivityFeed` → `session_turns` mirror →
`LiveChannelHub` → `activity-store` → `matchTurnToIdentity` → `deriveSessionStatus`. `scopeKind` is
`'global' | 'workspace' | 'voice'` on the wire (`contracts/chat/session-activity.ts:34`) and in the
schema (`schema/session-turns.ts:37`); `primarySessionId` rides every begin except A5-07's blip.

- **Identity matching:** one predicate, one home, with the asymmetry (global = family, voice/workspace/
  primary = identities) written down (`match-turn-to-identity.ts:15-24`). Every binding reader uses it:
  `use-session-statuses.ts:44-71`, `use-continuing-conversation.ts:58-70`, `VoiceChatPanel.vue:58-62`,
  `TasksPanel.vue:103-112`, `activity-store.ts:83-89`. **One reader does not: `use-working-rail.ts`
  (A5-01).**
- **Statuses incl. voice:** the fold admits voice (`fold-session-chains.ts:66-73`), the list drops it
  unconditionally (`get-sessions-overview.ts:44-47`), and the Voice chat menu row wears its own mark from
  its own door (`AppShell.vue:280-284` ← `use-voice-chat-status.ts` ← `GET /root/voice-chat/status`).
  `use-voice-chat-status.ts:51-60` runs the **same** `deriveSessionStatus` + the **same**
  `liveTurnStartedAtForEntry` — no third derivation home, exactly as D2 required.
- **The shell's global light** folds global ∪ voice by rank (`global-area-status.ts:29-36`), documented
  as a *picker over two already-derived ladders*, not a new one. Correct.
- **Sidebar / agent-run panes** key by session id and are unaffected by the identity change
  (`LiveSessionPane.vue:21-24` resolves out of the overview a voice entry can no longer reach — D's
  "unreachable filter" reasoning checks out).
- **Desktop overlay** now routes Stop by identity across three routes and refuses otherwise
  (`DesktopControlOverlayView.vue:112-147`), and the fold learns `sessionId` from `turn-updated`
  (`desktop-activity-fold.ts:271-285`). The honest gap it names — a spawned session's desktop turn has no
  stop route — is real (§2 #11).
- **Drift / double derivation:** `globalStatusView` (conversation ladder) → `globalStatus` (area ladder)
  → `foldGlobalAreaStatus` is three layers but one ladder each, each documented. The only genuine drift
  left is A5-01 and A5-06.

---

## 6. Session continuity everywhere

**Coverage is complete and now enforced.** `continuity-census.test.ts` walks the source tree and asserts
the `consumeSessionEventStream` set **equals** the `withBoundaryContinuity` set, and pins the roster at
five files. A sixth runner cannot land unwrapped.

Applied on every path: global web + voice (`run-global-root-turn-core.ts:325-338`), global channels +
delivery (same core), workspace chat and spawned/agent DM (`start-chat-turn.ts`), all three
`delegate-to-*`, the agent-run job. Schedules start fresh (nothing to continue); leaves are one-shot.

**Where it can break — after the arc:**

| Risk | Status |
|---|---|
| Timed-out run swapping outside any lock (round-1's worst break) | **CLOSED** — `route-request.ts:123-156` awaits the delegate; the pool releases in the tick's settle (`delegation-service.ts:188-209`) |
| Restart mid-checkpoint | **CLOSED** — durable on `primary_sessions`; survivor kept and continued (`pending-checkpoints.ts:128-134`, `run-turn-with-continuations.ts:80-97`); the follow-up job id persists so its claim still counts (`markContinuationJob`/`takeContinuationJob`) |
| A delivery eating the user's restart survivor | **CLOSED** — `autoContinue:false` drops only `checkpointedAt >= startedAt` (`run-turn-with-continuations.ts:92`), and the report tick's stray drop is guarded the same way (`run-report-delivery-tick.ts:504-506`) |
| Pressure denominator wrecked by a small-model visitor | **CLOSED** — `chat_sessions.lastContextWindow` written per usage report, copied forward on both swap writers, read by the swap decision (`segment-context-window.ts:36-55`), whoami (`resolve-whoami-report.ts:126`) and the overview meter (`compose-overview-entry.ts:137`) |
| Carry tail breaking on one long line | **CLOSED** (G4 — skip, not break) |
| Concurrent global + voice seeded swaps in one cwd | **STILL UNEXAMINED** — recorded as a live smoke by the arc itself; two `runSeededSwapSession` runs under two different locks share `ensureGlobalRootWorkspaceDir()` (`global-root-turn.ts:420`) |
| Continuation cap / lock scope | correct — cap counts across restarts on the row; continuations run under the same lock (`run-global-root-turn-core.ts:96-114`) and inside the same wall clock (`??=` at `global-root-turn.ts:373`) |
| Client rendering across segments | correct — both continuing payloads carry `segmentSessionIds`; the transcript reads are chain-spanning |
| Two chain-walk homes | open (improvement 5) |

**Improvements:** (a) extract `resolveChainSegments`; (b) give the dropped-checkpoint note a live
`ChatTurnEvent` so the user is *told*, not just recorded; (c) the swap-in-one-cwd question deserves a
deterministic test (two concurrent seeded swaps against one temp dir) rather than a live smoke.

---

## 7. Score — **8.5 / 10** (round 1: 7)

| Axis | R1 | R2 | Why it moved |
|---|---|---|---|
| Correctness | 6.5 | **8.5** | L1, G2, V1–V4, D2, M1 all closed and traced; CAS on the claim removes the settle race. −: A5-01 (a regression the arc itself introduced), A5-05. |
| Stuck-resistance | 5 | **8** | Wall clock on all three interactive streams, hard cap + lease + heartbeat + sweeper, ask reaper, daemon watchdog + connect deadline + abort, `turn-queued busy`, delivery yield. −: channel turn unbounded (A5-04), schedules unbounded, `acquire` still uncancellable, no Stop for spawned DMs. |
| Settings integrity | 6.5 | **8.5** | One default everywhere, one resolver, autoBuildout wired end-to-end on 5 of 7 paths, fit guard on every pick, voice tier forced + 403 on PATCH, spawned birth stamp. −: schedules, leaf rows, autoBuildout not on the delegation header. |
| Observability | 7 | **8** | `voice` first-class, `primarySessionId` on every begin, one predicate, a real voice status + menu mark + area fold, dead seed removed. −: A5-01 is an *observability* regression from the very stamp that fixed the class; children route unrendered; `api_retry` still invisible. |
| Continuity | 8 | **9** | Durable checkpoints + survivor rule, persisted denominator used by three readers, carry fix, and a census test that makes the invariant unforgettable. −: two walk homes, note has no live frame, cwd question untested. |
| Voice | 5.5 | **8** | Tier + auto on every leg, no card anywhere, no PATCH, own scope + own status, Stop by identity, watchdog + abort + connect deadline, queued line, recoverable≠failed, E3 shipped as a pair. −: A5-02 (no Stop for a daemon turn), A5-03 (call-leg dropped line), A5-01's voice chip. |
| Tests | 7.5 | **8.5** | The seams the P1s lived in now have tests (lock lifetime, call-leg tier, catch-up-not-consumed, census, identity match, hard cap, yield, delivery idempotency). −: `use-working-rail.test.ts` is a green test defending a dead wire — the exact class round 1 warned about ("a wrong comment is a bug report waiting to be believed"; a wrong fixture is worse). |
| Code health | 8 | **8** | Root routes split, the 911-line tick split by kind, comments carry their incident dates and their *deviations* (§6 is exemplary engineering hygiene). −: `run-task-job.ts` 415 lines, `constellation-scene.ts` 887, a dead export left behind. |

**+1 (to 9.5):** A5-01 (rail identity + its test) · A5-02 (two lines in VoiceChatPanel) · A5-03 (pass the
watchdog signal) · A5-04 (arm the wall clock in `runGlobalRootTurn`) · A5-05 (schedules to `auto` + a
clock). Every one is local and ships with a regression test.

**+3 (to 10):** the web-side identity census test (so the next wire change cannot silently strand a
reader) · the third Nodes level + Global/Voice nodes (the children route is already built) · a
`/sessions/:id/turn/interrupt` so every scope has a Stop with an owner · a bounded
`SessionTargetLocks.acquire` + client-abort cancellation · `api_retry` on the wire · a deterministic
concurrent-swap test for the shared global/voice cwd.

The arc did what it said: **every round-1 P1 is closed**, the acceptance bar in §4 is met on five of six
lines, and the one it misses ("no unbounded wait anywhere a turn can park") misses only on the two
surfaces the arc never listed — channels and schedules. That is a 7 → 8.5 move, and the remaining 1.5 is
four small fixes plus Kafi's live smokes.

---

## 8. Voice session review

**Trace, re-verified end to end.**
wake word → `VoiceSessionDriver.#runTurn` (`voice-session-driver.ts:250-287`) arms a 5-min watchdog →
`createBrainClient` POSTs `/root/turn {voice:true, tier…}` with the watchdog signal
(`run-brain-turn.ts:175-190`) → `streamGlobalRootTurn` branches on `input.voice`
(`global-root-turn.ts:146-150`) → `resolveVoiceConversationTarget` (own primary, scope `voice`) →
`resolveVoiceTierSettings` forces `auto`/sonnet-5/`low` **and fit-clamps the pin**
(`interactive-turn-settings.ts:78-104`) → no `ask_user` descriptor (`:217-227`) → feed
`begin({scopeKind:'voice', primarySessionId})` (`:334-339`) → `turn-queued{busy}` probe (`:401-406`) →
core: lock `${userId}:voice` (`root-turn-lock.ts:28-30`), hidden `'voice'` segments, catch-up skipped,
`autoContinue:false` (`:444-446`), wall clock armed in-lock → reply via the `speak` tool → `onSpeak`'s
four-party router (`main.ts:155-175`) → LineSpeaker / overlay relay. The daemon returns at the first
`session-completed`.

**What is right now (all newly verified):**
- The tier is forced **server-side** on both `/root/turn` and `/sessions/:id/turn`, so the daemon's body
  is belt-and-braces and the panel's chips are honest by construction (`AppComposer settingsLocked`,
  `VoiceChatPanel.vue:214-223`) and a PATCH is a typed 403.
- The spoken thread has an identity on the wire, its own status mark, and a status that reaches the
  shell's global light — a failed voice turn now lights `problem` somewhere.
- Stop reaches its own thread (`interrupt.ts:60-73`, owner-checked against `global|voice`), and the
  desktop overlay's Stop routes by identity across three routes.
- The daemon is no longer deaf: watchdog + abort + 10 s connect deadline + `turn-queued` line +
  recoverable-≠-failed.
- E3 shipped as the coupled pair, so a schedule/panel/delivery line during an overlay conversation is
  *played* instead of dropped-and-logged-as-played.

**Where it still breaks / sticks / drops (ranked):**
1. **A5-02 — no Stop for a daemon-driven turn** in the one panel that shows it. Highest, because Kafi's
   smoke list literally says "Stop on both threads".
2. **A5-03 — the call leg's late reply collides with the next turn and one line is silently swallowed.**
   The wake leg serialises through the speak queue; the call leg does not.
3. **A5-01's voice half — the working rail now offers a click straight into the spoken thread's hidden
   segment.** The server-side wall holds everywhere I probed *except* this UI door
   (`GET /root/sessions/:id` is owner-gated only).
4. **A5-09 — a stream that ends without `session-completed` is reported as completed**, so a
   wall-clock-cut voice turn can end in silence rather than the apology line.
5. **A5-10 — a relayed speak landing just after the overlay's own turn settles double-plays.**
6. Post-watchdog the user can start a second turn while the first still runs; both eventually speak, out
   of order relative to the questions. Bounded and announced ("One moment"), but a real UX edge.
7. Continuity **is** applied to the voice thread (own primary, own lock, `withBoundaryContinuity`, swap
   segments inherit `scope: 'voice'` at both swap writers) — the only open question is the shared cwd
   under a concurrent global swap, which the arc itself recorded as unexamined.

**The three open forks — my verdict:**

| Fork | Verdict |
|---|---|
| `direct_to_user` answers reach only the global catch-up net | **Now worth doing, and it is small.** Round 1 said "right problem, not first" because G2 (catch-up consumed by a turn that never ran) and V6 (dead `onSpeak` branch) were larger holes through the same surface. Both are closed. The remaining shape is: a voice-originated task's `direct_to_user` answer lands on the *global* thread, which the voice daemon never reads, so the user who asked by speech is never told. With `voice` now a first-class scope and the note rail already lateral, routing a `direct-delivery` whose requester chain is voice into a `speak` is a delivery-kind branch, not an architecture change. |
| Voice-fired TASKS parent on the global conversation | **Still correct as-is.** It was justified in round 1 by "voice has no status"; voice now *has* one, so the argument weakened — but the counter-argument got stronger: the Voice chat surface is a single panel with no task box, no sessions list and no node, so a task parented on the voice thread would be visible **nowhere**. Leave it on global until the Voice surface grows a work view. |
| Per-call sessions gain the routing toolset | **Unblocked — the prerequisite is met.** Round 1's blocker was "an `ask`-mode call session with carding tools multiplies the park class". The call leg now runs the forced tier (`auto`, no card ever, `session-turn.ts` + `call-session-client.ts:43-49`), and it has a watchdog. I would still land A5-03 first: adding tools makes call turns *longer*, which makes the late-reply collision routine instead of rare. |

---

## Round-1 P1 closure table

| ID | Round-1 finding | Status | Evidence |
|---|---|---|---|
| L1 | Delegation timeout releases the target lock under a live turn | **CLOSED** | `route-request.ts:17-27,123-156` (awaits the delegate; `capped` envelope), `delegated-turn-cancel-lever.ts`, `delegation-service.ts:188-209` (release in the tick's settle). Regression suites: `run-delegation-claim-and-run-tick.hard-cap.test.ts`. |
| V1 | Voice CALL leg runs `ask` | **CLOSED** | `session-turn.ts:105-112` (`input.voice` → tier), `:303` (no write), `call-session-client.ts:43-49`. |
| V2 | Voice turn announces as global with no primary → Global chat binds to the spoken thread | **CLOSED** | `global-root-turn.ts:334-339`; `match-turn-to-identity.ts`; `use-continuing-conversation.ts:66-70` (no fallback until the primary id is known). |
| V3 | Voice chain has no status anywhere | **CLOSED** | `fold-session-chains.ts:66-73` + `get-sessions-overview.ts:44-47,85-94` + `GET /root/voice-chat/status` + `use-voice-chat-status.ts` + `AppShell.vue:280-284,312-314`. |
| W1 | Card-less surfaces park unbounded; the daemon has no deadline | **CLOSED for voice, PARTIAL elsewhere** | Voice: `auto` never cards (`tool-approval-policy.ts:57-60`), no `ask_user`, watchdog + abort. Channels: `auto` by default + a 10-min ask bound, but **no turn clock** (A5-04). Schedules: still `bypass-with-behavior-gate`, floor cards (A5-05). |
| G1 | A parked ask/approval wedges the `${userId}` root lock; deliveries burn out | **PARTIAL** | Interactive trigger bounded (wall clock, suspended while parked); ask reaper added; global delivery yields instead of burning. **Channel trigger still unbounded** (A5-04). |
| G2 | Catch-up marked surfaced before `startChatSession` | **CLOSED** | `run-global-root-turn-core.ts:253-271` + `markCatchUpSurfacedOnSessionStarted` `:344-356`. |
| V4 | Voice-panel Stop interrupts the GLOBAL primary | **CLOSED** (wrong target gone) / **NEW gap** | `interrupt.ts:34,60-73`, `use-chat-turn.ts:312-327`. The panel now sends nothing — and shows no Stop at all for a daemon turn (A5-02). |
| M1 | Fit guard has one caller | **CLOSED** | `resolve-background-turn-settings.ts:76-94` (every delegated/agent-run/delivery pick), `run-global-root-turn.ts:269-282` (channels), `interactive-turn-settings.ts:84-97` (both voice legs). |
| S1/S2 | No lease, unbounded acquire, no root-lock deadline, no wall clock, no `turn-queued busy` | **MOSTLY CLOSED** | Lease + heartbeat + sweeper; wall clock ×3; `isRootTurnLockBusy` + sentinel. `SessionTargetLocks.acquire` still uncancellable (§2 #10). |
| V5 | Voice auto-continue vs a departed daemon | **CLOSED** | `global-root-turn.ts:444-446` (`autoContinue:false`). |
| V6 | `onSpeak` handed-off branch is a no-op | **CLOSED** | `main.ts:155-163` + the overlay's `isPlayingOwnTurn` skip. |
| V7 | Two modes/two models on one voice thread; chips PATCH a row voice never reads | **CLOSED** | Tier forced on every leg; `settingsLocked` chips; `updateChatSessionSettings` 403. |
| D1 | Delivery rail: budget not suspended on the global branch; timed-out delivery terminal; double-delivery; slot burn | **CLOSED** | `run-global-root-turn.ts:538-553` (gate marked), `routeRequest` cap, `insertChatMessageIfAbsent` + stable inbound id, the yield. |
| D2 | Restart destroys claimed `note` / `direct-delivery` rows | **CLOSED** | `delegation-orphan-settlement.ts:31-37` + `requeueOrphanedClaimedDeliveries`. |
| C1 | Process-wide checkpoint register | **CLOSED** | DB-backed `pending-checkpoints.ts` + survivor rule. (`swapping-primaries` is still in-process — deliberate: it guards a within-turn window.) |
| T1 | Mode inversion / default asymmetry | **CLOSED** | Resolved mode stamped unconditionally on all three streams; one default everywhere. |
| T2 | Spawned / agent / leaf born NULL | **PARTIAL** | Spawned closed (`routes/sessions/index.ts:82-105`); leaf still NULL (`record-leaf-session.ts`) — behaviour correct via the resolver, row hygiene open. |
| T3 | Agent-run effort / follow-up origin | **PARTIAL** | Effort carried; `origin` deferred (§7). |
| T4 | `autoBuildout` read by no runner | **CLOSED** | Autopilot marker on global core, both interactive streams, channels, and every routed delegate (`routed-turn-provider-input.ts:190`). |
| N1–N4 | Nodes: unscoped read · unwired `hasAnswered` · index-keyed buffers + layouts · not enlargeable | **CLOSED** (structure) / **PARTIAL** (use) | All four bugs fixed; the enlargement machinery landed but the third level, the Global node and the Voice node are unbuilt (§5a). |

---

## Top 10, ranked

| # | ID | Sev | One line | Where | Confidence |
|---|---|---|---|---|---|
| 1 | A5-01 | P2 | Working rail lost the brain chip: every global/voice turn rails as a nameless "Working…" session chip; the voice chip opens the spoken thread | `use-working-rail.ts:128,150` · `WorkingRail.vue:33,57` | **REPRODUCED** |
| 2 | A5-04 | P2 | A channel global turn has no wall clock and can hold the `${userId}` root lock forever | `sessions/run-global-root-turn.ts` (absent) · `channels-service.ts:90` | CONFIRMED |
| 3 | A5-02 | P2 | Voice panel shows no Stop for a daemon-driven turn, and the guard would send nothing anyway | `VoiceChatPanel.vue:218,222` · `use-chat-turn.ts:312` | CONFIRMED |
| 4 | A5-03 | P2 | Call watchdog never aborts its read → a late reply collides with the next turn's speech and one line is silently dropped | `call-conversation.ts:226,247` · `line-speaker.ts:52` | CONFIRMED |
| 5 | A5-05 | P2 | Schedules still run `bypass-with-behavior-gate` (floor cards) with no turn bound, no lock, no settings resolution | `fire-schedule.ts:139` · `tool-approval-policy.ts:106` | CONFIRMED |
| 6 | — | P2 | No Stop route for a spawned-session DM turn — client abort only; the server turn runs to the 60-min clock | `use-session-turn.ts:37-42` · `interrupt.ts:34` | CONFIRMED |
| 7 | — | P2 | `GET /sessions/:id/children` + `SceneNodeRef` voice/global kinds ship with no renderer; no Global or Voice node exists | `routes/sessions/index.ts:586` · `NodesView.vue:111-114` | CONFIRMED |
| 8 | — | P3 | `use-working-rail.test.ts` constructs the pre-arc wire, so the regression above stays green — the arc has no web-side identity census | `use-working-rail.test.ts:52,54` | CONFIRMED |
| 9 | A5-06 | P3 | Global chat polls its transcript while only the voice thread runs (`hasGlobalServerTurn` is the area, not the identity) | `GlobalChatView.vue:211-217` | CONFIRMED |
| 10 | — | P3 | `ApprovalWaitGate.onParkedChange` silently overwrites its single subscriber; `listRunningSessionTurnsForUser` is dead; two chain-walk homes | `approval-wait-gate.ts:34` · `session-turns.ts:67` · `list-session-children.ts:165` | CONFIRMED |

---

## Score

**8.5 / 10** (round 1: 7). Every round-1 P1 is closed and traceable; the two acceptance-bar misses are
surfaces the arc never enumerated (channels, schedules); the one regression it introduced (A5-01) is the
predictable cost of changing the wire for a reader set the merge did not census. Four local fixes and a
web-side identity census would take this to 9.5.
