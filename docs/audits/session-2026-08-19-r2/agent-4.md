# Session system audit — round 2, agent 4

Worktree `.claude/worktrees/session-audit` @ `71dbe151` (main + the merged session-hardening arc).
Entry point: **continuity + settings**, then widened to the delegation engine, the streams, the
bounds, and (via two sub-auditors whose citations I re-opened myself) the web monitoring layer and
the voice daemon.

**Method.** Docs were treated as claims; code won. The arc's own `§6` cross-slice asks and `§7`
"the lead folded every ask" claim were used as a checklist — each is a one-grep verification with a
pre-written provenance trail. Every P0/P1 below is traced hop-by-hop or reproduced by a throwaway
vitest I ran and deleted. Findings are marked **CONFIRMED** (I read the whole chain, or ran a test)
or **PLAUSIBLE** (reasoned from code I read, but one hop is inference).

**Headline.** The arc did what it said. Every round-1 P1 is closed at the code level, most of them
with a regression test that pins the incident. The new mechanisms (hard cap = interrupt-and-await,
lease + sweeper, pausable wall clock, DB-backed checkpoints, `scopeKind: 'voice'`, one settings
resolver, the CAS-on-claim terminal writes) are genuinely well built. **Two things it did not
close, and one it broke:**

- the **single-slot** pending-checkpoint register makes the arc's own headline feature — "a restart
  mid-checkpoint continues" — silently lose the survivor in its *most likely* scenario (**C-1**,
  reproduced);
- **schedule fires** are the one runner the arc's stated assumptions covered and the slices did not
  reach: still hard-coded `bypass-with-behavior-gate`, no wall clock, no model/effort/autopilot
  (**T-1**);
- the model is told, on **every** turn, that Vynel continues it automatically after a checkpoint —
  which is false on voice, on delivery turns and on channels-with-no-listener (**C-2**).

---

## 1. Bugs — all scopes

### NEW findings

---

**C-1 · P1 · global · workspace · spawned · agent · voice · delivery — a restart-survivor checkpoint is silently destroyed when the next turn checkpoints too**

*Where.* `packages/session/src/continuity/pending-checkpoints.ts:74-87` (`markPendingCheckpoint` —
one slot, unconditional overwrite) · `packages/session/src/runtime/run-turn-with-continuations.ts:80-97,
102-124` (survivor read, then the loop re-peeks the *same* slot) ·
`packages/session/src/delegation/run-report-delivery-tick.ts:499-511` (the G-3 stray-vs-survivor test).

*Evidence.* The register is one slot on `primary_sessions`:

```ts
export function markPendingCheckpoint(db, primarySessionId, nextStep, deps = {}) {
  const row = primarySessionsRepository.patchPendingCheckpoint(db, primarySessionId, {
    pendingCheckpointNextStep: nextStep,          // overwrites whatever was there
    pendingCheckpointAt: (deps.now ?? (() => new Date()))(),
    pendingCheckpointJobId: null,
  })
```

`runTurnWithContinuations` reads the survivor at :80, logs *"a pending checkpoint survived from
before this turn — it continues after it"* (:82-86), and then at :102 peeks **the slot again** —
which by then may hold a *different* checkpoint the turn just wrote. The `autoContinue: false`
survivor guard is a timestamp comparison on that same slot
(`if (input.autoContinue === false && checkpoint.checkpointedAt < startedAt) return`, :92), so it
cannot tell "the survivor is still there" from "the survivor was overwritten by this turn's stray".
The report tick's G-3 recipe (`pending.checkpointedAt >= notifyTurnStartedAt`, :504) has the
identical blind spot.

*Reproduced* (throwaway vitest, run then deleted):

| probe | setup | expected by the design notes | actual |
|---|---|---|---|
| H1 | survivor `"SURVIVOR STEP"`; genuine turn checkpoints `"NEW STEP"` | survivor continued after the turn | only `"NEW STEP"` continued; **zero** dropped-checkpoint notes on the thread — the survivor vanished with no trace |
| H2 | survivor `"SURVIVOR STEP"`; `autoContinue:false` delivery turn checkpoints `"DELIVERY STRAY"` | survivor left alone, stray noted | pending slot = `null`; the only note names `"DELIVERY STRAY"` — **the survivor is gone** |

*Failure scenario.* The survivor exists *precisely because the context was near-full when the
process died*. The user's next message resumes that same near-full head, the mid-turn CONTEXT CHECK
fires, the model checkpoints again — and the pre-restart next step (possibly an entirely different
task) is dropped with no note, no log and no continuation, while the log line one screen earlier
promised it would run.

**This is unambiguous loss, not "latest intent wins".** The pending step is surfaced to the model
only inside a *swap*'s carry (`runtime/build-continuity-context.ts:133-138` — the `CHECKPOINT:` section);
nothing injects it into a plain resumed turn's provider input. So the model whose checkpoint
overwrites the survivor **never saw the survivor**. It is not superseding a step it read and judged
stale; it is clobbering one it could not know existed. The register's own header ("a second call
before the swap replaces the first — the latest intent wins") describes the double-checkpoint-in-one-turn
case, which is genuinely last-write-wins; it was never true across turns, and the arc introduced the
cross-turn case when it made survivors durable.

H2 is rarer but strictly worse: a colleague's report landing on the user's workspace before their
next message destroys the survivor and writes a note naming the *wrong* step. This is the exact class
G1 was commissioned to close, and it is one of Kafi's live smokes ("a restart mid-checkpoint
continues") — which will pass or fail depending on whether the smoke's second turn happens to
checkpoint.

*Minimal fix.* Make the slot survivor-aware in one place: `markPendingCheckpoint` takes the
current row first and, when a checkpoint is already pending, either (a) drops it visibly first
(`dropPendingCheckpoint(db, id, { reason: 'superseded' })` — one new reason word, the note
machinery already exists) or (b) refuses and answers the model "you already have a pending
checkpoint". (a) is honest and two lines. Either way the guard at
`run-turn-with-continuations.ts:92` and the tick's `:504` become sound, because the slot can no
longer silently change identity.

**CONFIRMED** (reproduced).

---

**C-2 · P2 · voice · delivery · channels — every turn is told Vynel will auto-continue it after a checkpoint; three runner families never do**

*Where.* `packages/session/src/mcp/session-mcp-feature-descriptor.ts:27-33`
(`SESSION_PROMPT_INSTRUCTIONS`, contributed on *every* turn) + `:64` (`toolNames` always includes
`CHECKPOINT_TOOL_NAME`) · `packages/session/src/mcp/checkpoint-tool.ts:21-27, 66-72` (the tool's own
answer) · attached unconditionally at `apps/local-api/src/streams/global-root-turn.ts:198-201, 274`
(voice included), `apps/local-api/src/sessions/run-global-root-turn.ts:307-308, 337` (channel +
delivery), `apps/local-api/src/sessions/build-workspace-background-mcp.ts:60, 186` (every delegated
turn).

*Evidence.* The tool answers, verbatim:

```
`Checkpoint noted: "${nextStep}". Now END this turn with one line telling the user you will
continue after patching context — do not start the next step here. Vynel will continue you on
a fresh context with that step automatically.`
```

But the voice leg passes `autoContinue: false` (`global-root-turn.ts:445`), every delivery/notify
turn passes `autoContinue: false` (`run-global-root-turn.ts:475`), and
`run-turn-with-continuations.ts:104-107` then drops the checkpoint with reason `never-continues`.
The mid-turn nudge is suppressed for those turns (`run-global-root-turn-core.ts:239`) but the tool
and the standing instruction are not.

*Failure scenario.* On voice the user *hears* "I'll continue after patching context" and then
silence; the explanatory note row lands on a hidden `voice`-scope thread nobody reads. On a
delivery turn the requester's transcript ends with the same broken promise plus a "Not continued"
row. There is no server-side backstop: the drop is after the fact.

*Minimal fix.* Thread the turn's `autoContinue` into `buildSessionFeatureDescriptor` (it already
takes a deps bag) and, when false, either omit `CHECKPOINT_TOOL_NAME` from `toolNames`/the server
or have `buildCheckpointResponse` answer "this turn does not continue automatically — finish what
you can and say where things stand" (the existing no-identity branch's shape). One argument, one
branch.

**CONFIRMED** (attachment sites and `autoContinue` values read end to end).

---

**T-1 · P2 · schedules — schedule fires are the one runner D3/D8 never reached: hard-coded `bypass-with-behavior-gate`, no model/effort/autopilot, no wall clock**

*Where.* `packages/schedules/src/firing/fire-schedule.ts:139` —
`permissionMode: 'bypass-with-behavior-gate', // D10`.

*Evidence.* A repo-wide census of the literal shows every other reachable fallback is gone
(`?? 'ask'`: **zero** production hits; `bypass-with-behavior-gate` survives only as a type member,
a comment, the provider's own mapping, the by-design leaf rail
`packages/orchestration/src/leaf/{map-agent-to-leaf-input.ts:34,push-to-session.ts:36}`, the
internal distill `run-seeded-swap-session.ts:77`, the context report
`get-session-context-report.ts:34`, and **this line**). `fire-schedule.ts` also never calls
`resolveTurnSessionSettings` / `resolveBackgroundTurnSettings`, so a schedule fire ignores the
workspace's model, effort and `autoBuildout`; and a grep for `timeout|hardCap|waitGate|maxMs` in
that file returns only a comment — the fire has **no** turn bound of any kind.

*Failure scenario — and it blocks siblings.* A 03:00 schedule that edits a file cards under the
floor (`tool-approval-policy.ts:109-111`) and parks with nobody watching; the only release is the
approvals reaper at `requestedAt + 2×5 min`. The fire tick then **`await`s each fire serially**
(`packages/schedules/src/firing/run-schedule-claim-and-fire-tick.ts:36, 56-66` — one `for` loop over
every due schedule, `await fireSchedule(...)` per iteration), so every other schedule claimed in that
same tick waits behind the parked one. In the other direction the service has **no in-flight guard
and no pool**: `apps/local-api/src/services/schedules-service.ts:54-58` launches a detached tick
every 60 s regardless, so slow fires stack live provider sessions without a cap — the delegation
service's bounded pool has no counterpart here. Meanwhile the arc's §2 explicitly assumed "schedule
fires resolve the requester row's mode `?? DEFAULT` (D3) — no more hardcoded NULL→unattended", and
§6 recorded only the *autoBuildout* half as a follow-up. An `auto`-mode user gets a carding
schedule; a `bypass` user gets one too.

*Minimal fix.* `fire-schedule.ts` resolves through `resolveTurnSessionSettings(db, workspacePrimary
head row)` like the channel runner does (`run-global-root-turn.ts:266-283`), and the schedules
service gets the same `startTurnWallClock`/`ApprovalWaitGate` pair the three streams already share.
If D10's hardwire is deliberate, the arc's §2 assumption should be retracted in writing — right
now the note and the code disagree.

**CONFIRMED.**

---

**T-2 · P2 · docs/product — D3's `auto` default turned off the product's headline safety promise, and the promise was not updated**

*(Not a re-litigation of D3 — a consequence check, which the brief asks for. **The mode matrix
itself is correct and well-documented** at `tool-approval-policy.ts:6-23`; what follows is about the
`unset` case moving, and about a doc that still says otherwise.)*

*Where.* `packages/session/src/session-mode.ts:82` (`DEFAULT_SESSION_MODE = 'auto'`) ·
`packages/providers/src/claude/approvals/tool-approval-policy.ts:56-58, 107-108` · `CLAUDE.md:4`.

*Evidence.* `decideCanUseTool` stands the floor down **before** consulting the always-card set:

```ts
export function approvalFloorStandsDown(mode) { return mode === 'auto' || mode === 'bypass' }
...
export function decideCanUseTool(toolName, mode, sets) {
  if (approvalFloorStandsDown(mode)) return 'allow'          // ← ahead of isAlwaysCardTool
```

So under `auto` neither the static floor (`Bash`/`Write`/`Edit`/`NotebookEdit`) nor a feature's
declared `mutatingToolNames` card. Before the arc a user who had never touched the chips ran `ask`
on workspace/DM threads and `bypass-with-behavior-gate` on the global one — both of which card the
floor. After D3 a user who has never touched the chips runs `auto` **everywhere**, and nothing cards
anywhere.

*Why it matters.* `CLAUDE.md:4` still describes Vynel as *"a trustworthy experience layer: visible
memory, curated skills, **an approval card on every irreversible action**"*; the module notes' D3 row
says only "users who explicitly picked Ask/Bypass keep it (persisted)" and never states that the
*unset* case moved from carding to not-carding. The code is right; the product contract and the
default no longer agree.

*Minimal fix.* A decision, not a patch: either onboard new users onto `ask` (a stored row value, not
a second default constant — the one-default rule survives), or update `CLAUDE.md` + `docs/vision.md`
to say what the app now promises.

**CONFIRMED.**

---

**T-3 · P2 · desktop-control — the same default silently widened desktop plan authority from `display-only` to `standing-consent`**

*Where.* `packages/desktop-control/src/plan/desktop-plan-consent.ts:19-23` ·
`apps/local-api/src/streams/global-root-turn.ts:292` · `apps/local-api/src/streams/session-turn.ts:210`.

```ts
case 'auto':
case 'bypass':
  return 'standing-consent'
default:
  return 'display-only'     // the conservative floor the header calls "a background turn can never self-grant"
```

*Evidence.* Both call sites pass the turn's *resolved* mode, which is now `auto` for any user who
has not picked a chip. Before D3 an unset global thread resolved `bypass-with-behavior-gate`, which
this switch does **not** name — so it fell to `default: 'display-only'`. The same edit that changed
the tool-card default therefore also flipped who may authorize a desktop plan, in a different
package, with a different owner, and D3's consequence row does not mention it. The file's own header
states the rule it is now violating for the unset case: *"preserving 'a background turn can never
self-grant'"*.

*Minimal fix.* `deriveDesktopPlanConsent` should key on an **explicit** user pick, not on the
resolved mode — e.g. take `{ mode, wasExplicit }` and return `'standing-consent'` only when the user
actually chose auto/bypass. Two lines at the two call sites (`turnSettings.mode !== undefined`
already distinguishes them).

**CONFIRMED.**

---

**S-1 · P2 · workspace · spawned — the interactive queue wait is still unbounded and uncancellable; only the *holder's* bound limits it**

*Where.* `packages/session/src/delegation/session-target-locks.ts:28-35` (`acquire` returns a
promise with no deadline, no abort) · `apps/local-api/src/streams/chat-turn.ts:550`
(`const releaseTargetLock = await locks.acquire(workspaceId)`) ·
`apps/local-api/src/streams/session-turn.ts:281` (same) · the wall clock arms only *after* the lock
(`chat-turn.ts:401-403`, `session-turn.ts:419`) — deliberately, per its own comment.

*Evidence.* Round-1's S1 asked for "a bounded `SessionTargetLocks.acquire`". The arc bounded the
*holder* instead (`VYNEL_DELEGATED_TURN_MAX_MS` = 60 min, `VYNEL_INTERACTIVE_TURN_MAX_MS` = 60 min)
and shipped the `turn-queued` sentinel. That converts "forever" into "up to 60 min per holder,
multiplied by the queue depth", with no visible position and no way out: the composer shows
`turn-queued { reason: 'busy' }` once and then nothing for an hour.

*Failure scenario.* A user sends a message into a workspace whose delegated task is 55 minutes into
a 60-minute cap. The SSE connection stays open (one of Chrome's six per-host sockets), the composer
says "busy", and nothing else happens for ~5 minutes — or an hour if a second task claims the key
first. Closing the tab does not cancel: `acquire` is uncancellable, so the abandoned request still
takes the lock and runs a full provider turn into a dead stream (Hono's `StreamingApi.write`
swallows), holding the key for another budget.

*Minimal fix.* (a) give `acquire` an `AbortSignal` and pass the request's; (b) re-emit
`turn-queued` on a heartbeat so the composer can say "still waiting"; (c) cap the wait at
`VYNEL_INTERACTIVE_TURN_MAX_MS` and fail with the same honest row the wall clock writes.

**CONFIRMED** (code read end to end; not reproduced — a 60-minute test is impractical).

---

**M-1 · P3 · delegation — the lease sweeper can requeue a live message delivery whose heartbeat was starved, producing a second delivery turn**

*Where.* `apps/local-api/src/services/delegation-service.ts:133-139` (60 s sweep) ·
`apps/local-api/src/services/delegation-orphan-settlement.ts:33` (`requeueOrphanedClaimedDeliveries`)
· `packages/orchestration/src/repositories/delegation-jobs-recovery.ts:29`
(`ORPHAN_REQUEUE_JOB_KINDS = ['report-delivery','direct-delivery','note']`) ·
`packages/session/src/delegation/delegation-lease-heartbeat.ts:24-39`.

*Evidence.* The heartbeat is a plain `setInterval` on the same (synchronous, better-sqlite3) event
loop the runs use. If six consecutive beats are missed the lease lapses and the sweeper requeues
the row while the run is still going. The CAS-on-claim (`55a29bfc`) makes the *first* run stand
down cleanly at terminal time, and the pool's `excludeTargetKeys` prevents a concurrent second
claim — so the message is not delivered twice *simultaneously*, but it **is** delivered twice
sequentially (a second full notify turn). The inbound *row* is idempotent
(`insertChatMessageIfAbsent` + the delivery-job id as its stable id), so the user sees one report
row and two assistant replies to it.

*Failure scenario.* Requires ~3 minutes of heartbeat starvation — implausible on a healthy box,
reachable during a very heavy migration/vacuum or a long GC pause. Recorded as latent, not urgent.

*Minimal fix.* Have the run's own settle path re-assert the lease as part of its terminal CAS, or
have the sweeper require `leaseExpiresAt < now - grace` with a grace of one further lease.

**PLAUSIBLE** (each hop read; the starvation itself not reproduced).

---

**M-2 · P3 · global · voice — `POST /root/turn/interrupt` answers `{ interrupted: true }` for a session that was not running**

*Where.* `apps/local-api/src/routes/root/interrupt.ts:72-73, 79-80`.

```ts
await interruptChatSession(DEFAULT_PROVIDER_ID, namedSessionId)
return c.json({ interrupted: true })
```

The provider's interrupt is a registry lookup that no-ops for an unknown session; the route reports
success regardless, and the response schema's own description says `false` means "has no session to
interrupt". A Stop pressed a beat after the turn ended reads as a successful stop. Cheap fix: return
the provider's own boolean.

**CONFIRMED.**

---

**M-3 · P3 · continuity — the denominator rule has two implementations**

*Where.* `packages/session/src/continuity/segment-context-window.ts:35-55` (the declared one home,
with the chain walk) vs `packages/session/src/overview/compose-overview-entry.ts:137`
(`tail.lastContextWindow ?? resolveContextWindow(model)` — the same rule, hand-rolled, without the
chain fallback).

They agree today because the fold already resolves `model` to "the chain's newest known one". A
fresh swap segment with neither column set still differs: the helper walks predecessors, the
overview does not. One line (`resolveSegmentContextWindow(db, tail.id).contextWindow`) collapses
them; the reason it wasn't done is stated in §6 G-6 as "optional".

**CONFIRMED.**

---

**M-4 · P3 · orchestration — `startPausableTimeout` never unrefs its timer and never unsubscribes from the gate**

*Where.* `packages/orchestration/src/routing/pausable-timeout.ts:33, 44`.

`handle = setTimeout(() => resolve(), remainingMs)` with no `.unref()`, and
`waitGate?.onParkedChange(...)` with no removal on `cancel()`. Both are contained today (gates are
per-turn, and the api process has a listening server anyway), but every other timer in the arc
(`delegation-lease-heartbeat.ts:40`, `asks-recovery-service.ts:47`) does unref — this is the one
that doesn't. A 60-minute armed cap will hold a `stop()`ed test harness or a CLI process open.

**CONFIRMED.**

### Round-1 P1s — verified in this checkout

| ID | Round-1 finding | Verdict | Evidence |
|---|---|---|---|
| **L1** | Delegation timeout releases the target lock under a live turn | **CLOSED** | `route-request.ts:105-156` — the cap fires `onHardCap` (cancel lever → provider interrupt) and *keeps awaiting the delegate*; the envelope reads `capped` only after it settles. The pool's `.finally` is attached to the whole tick (`delegation-service.ts:188-209`), and the tick returns only when the runner does (`run-delegation-claim-and-run-tick.ts:159-167`). Pinned by `run-delegation-claim-and-run-tick.hard-cap.test.ts` ("two jobs on one target never run concurrently…"). |
| **V1** | Voice CALL leg runs `ask` | **CLOSED** | `interactive-turn-settings.ts:67, 78-104` — `input.voice` returns the tier (`VOICE_TIER_MODE` = `auto`, model, `low`) with **no** row read and a fit clamp; `session-turn.ts:106-111` uses the same one home and does not write through. Daemon sends `{ mode: VOICE_TIER_MODE, voice: true }` (sub-audit, re-verified). |
| **V2** | Voice announces as `scopeKind:'global'` with no `primarySessionId` | **CLOSED** | `global-root-turn.ts:334-339` stamps `scopeKind: isVoiceTurn ? 'voice' : 'global'` **and** `primarySessionId` on every leg; `'voice'` is on the wire (`contracts/chat/session-activity.ts:34`). |
| **V3** | Voice chain never enters the overview → no status | **CLOSED (with a deliberate deviation)** | `fold-session-chains.ts:73` admits `voice`; `get-sessions-overview.ts:46` drops it unconditionally from the shared read (so `list_sessions` cannot leak it) and `:89-93` serves it through the dedicated `getVoiceChatOverviewEntry`. The deviation from §3 D2 is documented and is the safer design. |
| **W1** | Card-less surfaces park unbounded | **CLOSED for voice/channels/delegation; STILL OPEN for schedule fires (T-1)** | Voice runs `auto` (no Vynel card at all) and attaches no `ask_user` (`global-root-turn.ts:217-227`); channels resolve `row ?? auto` and bound their ask at 10 min; every delegated turn has the pausable hard cap. `fire-schedule.ts:139` is the residue. |
| **G1** | One parked ask/approval wedges the `${userId}` root lock forever | **CLOSED (bounded, not eliminated)** | `VYNEL_INTERACTIVE_TURN_MAX_MS` (60 min working time) + `VYNEL_INTERACTIVE_ASK_MAX_MS` (2 h) + the 60 s `asks-recovery-service` + `turn-queued { busy }`. Worst case is now ~2 h, not forever. A global delivery no longer burns its budget behind the lock — it yields its slot (`run-report-delivery-tick.yield.test.ts`). |
| **G2** | Catch-up marked surfaced before `startChatSession` | **CLOSED** | `run-global-root-turn-core.ts:260-271` + `markCatchUpSurfacedOnSessionStarted` (:344-356) — the mark fires on the provider's first `session-started`, and a failed mark is a repeat, never a loss. |
| **V4** | Voice-panel Stop interrupts the GLOBAL primary | **CLOSED** | `routes/root/interrupt.ts:60-73` — owner-checked `sessionId`, `INTERRUPTIBLE_SCOPES = {global, voice}`, 404 on anything else; the desktop overlay's `canStop` is identity-keyed (`DesktopControlOverlayView.vue:127-148`); a voice surface with no known session sends nothing (`b71561c1`). |
| **M1** | Fit guard has one caller | **CLOSED** | Three call sites now cover every runner: `interactive-turn-settings.ts:85` (all three interactive streams incl. voice + the call leg), `resolve-background-turn-settings.ts:77` (every delegated/agent-run/delivery turn, with `fallbackModel: agent.model`), `run-global-root-turn.ts:270` (channels + the global delivery). |

### Round-1 P2s — spot verdicts

| ID | Verdict | Evidence |
|---|---|---|
| S1 (no lease, unbounded acquire, no wall clock) | **PARTIAL** | Lease + heartbeat + sweeper ✓ (`delegation-lease-heartbeat.ts`, `delegation-service.ts:133`); wall clock ✓ (`turn-wall-clock.ts`, all three streams); **`SessionTargetLocks.acquire` still unbounded** → S-1 above. |
| S2 (no `turn-queued{busy}`) | **CLOSED** | `global-root-turn.ts:401-406` + `isRootTurnLockBusy` (`root-turn-lock.ts:35-37`). |
| V5 (voice auto-continue) | **CLOSED** | `global-root-turn.ts:445` `autoContinue: false`. |
| V6 (`onSpeak` no-op) | see §8 | E3's coupled fix — verified in both halves. |
| V7 (typed vs spoken settings) | **CLOSED** | Tier forced server-side on every leg; `updateChatSessionSettings` throws `ForbiddenError` on a `voice` row (`update-chat-session-settings.ts:44-47`); the panel's chips are read-only. |
| D1 (delivery rail) | **CLOSED** | Both branches mark the gate (`run-report-delivery-tick.ts:337, 419`); a capped delivery requeues (`run-report-delivery-tick.yield/idempotent` suites); the retry is idempotent via the delivery-job id as the inbound row id. |
| D2 (restart destroys note/direct rows) | **CLOSED** | `ORPHAN_REQUEUE_JOB_KINDS = ['report-delivery','direct-delivery','note']` (`delegation-jobs-recovery.ts:29`), applied by boot **and** the lease sweeper through one policy (`delegation-orphan-settlement.ts`). |
| C1 (process-wide checkpoint register) | **CLOSED for durability, OPEN for correctness** | DB-backed on `primary_sessions` ✓; the single slot is C-1 above. `swapping-primaries.ts` is still a process Map — deliberately (it guards an in-flight op). |
| T1 (mode inversion / default asymmetry) | **CLOSED** | Resolved mode stamped unconditionally on all three streams (`global-root-turn.ts:182-183`, `chat-turn.ts`, `session-turn.ts:118-124`); one `DEFAULT_SESSION_MODE = 'auto'` (`session-mode.ts:82`). |
| T2 (children born NULL) | **PARTIAL (as recorded)** | Spawned ✓ (`routes/sessions/index.ts:91-105` + `record-spawned-session-segment.ts:84-92`); **leaf still NULL** (`record-leaf-session.ts:48-64`) — behaviourally correct because leaves hard-code their mode by design, so this is row hygiene. Declared deferred in §7. |
| T3 (agent-run effort) | **CLOSED** | `enqueue-agent-run.ts:60,106` + `composer-mention-turn.ts:196-198` + the checkpoint follow-up's shared spread (`enqueue-checkpoint-continuation.ts:151-163`). `origin` on agent-run rows is the recorded deferral. |
| T4 (`autoBuildout` read by nobody) | **CLOSED except schedules** | Global core `:189`, all three streams (`chat-turn.ts:331`, `session-turn.ts:347`, `global-root-turn.ts:437`), `start-chat-turn.ts:187`, every delegated runner via `composeRoutedTurnProviderText` (`routed-turn-provider-input.ts:190`), channels via `run-global-root-turn.ts:283,448`. Schedules: nowhere (T-1). |
| N1–N4 (nodes) | see §5 | |

---

## 2. Stuck points

| # | Stuck point | How it happens | Bound today | Recovery | Evidence |
|---|---|---|---|---|---|
| 1 | Interactive turn on an approval card | floor tool under `ask`/`bypass-w-gate`; card is an unbounded await | wall clock **suspended** while parked; approvals reaper denies at `requestedAt + 2×5 min` | user answers, or the reaper | `turn-wall-clock.ts:74-88` · `pausable-timeout.ts:39-45` |
| 2 | Interactive turn on `ask_user` | user walks away from the form | 2 h (`VYNEL_INTERACTIVE_ASK_MAX_MS`) + a 60 s orphan reaper | the waiter's own timer, else the reaper | `global-root-turn.ts:223` · `asks-recovery-service.ts` |
| 3 | **Schedule fire on a card — and every schedule batched with it** | 03:00 fire under hard-coded `bypass-w-gate`; the tick `await`s each due schedule **serially** | approvals reaper only; **no turn bound, no in-flight guard, no pool** | reaper (~10 min per card, repeatable); siblings in the same tick wait it out; later ticks launch anyway and stack live sessions uncapped | `fire-schedule.ts:139` · `packages/schedules/src/firing/run-schedule-claim-and-fire-tick.ts:36,56-66` · `services/schedules-service.ts:54-58` — **T-1** |
| 4 | Global root lock wedged | one interactive turn parked on an ask | ≤ 2 h + 60 min working | the ask resolves, the clock cuts the turn, or the reaper | `root-turn-lock.ts:41-56` (no deadline of its own) |
| 5 | **Interactive turn queued on a target lock** | a delegated run holds the workspace key | the *holder's* 60 min × queue depth; the waiter has no clock and no abort | holder releases | **S-1** |
| 6 | Client disconnects while queued | `locks.acquire` is uncancellable | the abandoned turn still runs a full budget into a dead stream | none | `chat-turn.ts:550` · `session-turn.ts:281` |
| 7 | Delegated run past its cap | the interrupt lands but the provider stream is slow to end | unbounded *after* the cancel — `routeRequest` awaits the delegate with no second-level escape | provider start is bounded (`run-claude-chat-session.ts:178-197`) and `abortController.abort()` ends the query; a wedge here needs a restart | `route-request.ts:123-145` · `delegated-turn-cancel-lever.ts:51-54` |
| 8 | Delegated run whose heartbeat starves | 6 missed beats → sweeper settles | 3 min; CAS makes the first run stand down | self-healing, but a message kind runs twice — **M-1** | `delegation-service.ts:133` |
| 9 | Voice turn / daemon | see §8 | watchdog `VYNEL_VOICE_TURN_WATCHDOG_MS` (5 min) + abort + connect deadline | daemon speaks "still working" and returns to listening | §8 |
| 10 | Continuation loop | a model that checkpoints every turn | `MAX_CONSECUTIVE_CONTINUATIONS = 3`, depth durable across restarts | cap-reached drop + a visible note | `pending-checkpoints.ts:38,112-119` |
| 11 | Report delivery queued on a busy root lock | global delivery claimed while the root lock is held | yields the slot, requeues due in 5 s, **no attempt spent** | automatic | `run-report-delivery-tick.yield.test.ts` |

**Bounded and correct (re-verified, do not re-spend budget):** the pausable timeout measures working
time only and is shared by *every* bound in the system; `activityHandle.end` is first-wins so a
failed turn cannot be re-labelled "ended" by a `finally` (`session-activity-feed.ts:153-155`); the
terminal delegation writes are a CAS on the claim so a swept row cannot be flipped back; the
boot pass and the lease sweeper run **one** policy (`delegation-orphan-settlement.ts`); provider
startup is bounded (`SESSION_STARTUP_TIMEOUT_MS`); the cancel lever arms before the id exists and
fires on arrival; `onSessionResolved` fires on `user-message-persisted` **and** `session-created` in
all five runners, so a *resumed* delegated turn is interruptible from its first frame;
`DelegationCancelRegistry` (`delegation/delegation-cancel-registry.ts:38-65`) is clean under the new
CAS world — `begin` replaces the map entry for a reclaimed key and `end` deregisters by **identity**
(`if (this.runs.get(key) === run)`), so a stale handle from a swept run cannot deregister its live
successor, and a `requestCancel` before the session id exists still flags the terminal read;
round-1's P3 "two bare writes where one transaction is the rule" is closed at
`settle-failed-delegation-attempt.ts:111-116` (fail + surfaced-mark now co-commit) and the tick's
former `:821/:832` pair moved into `run-task-job.ts:342-352`, where each branch is a single write.

---

## 3. Modes · models · effort · autoBuildout — binding and inheritance

Rule everywhere: **`input/tool-arg ?? row ?? DEFAULT('auto')`**, one resolver per family —
`resolveTurnSessionSettings` (`packages/chat/src/settings/resolve-turn-session-settings.ts:40-50`)
wrapped by `resolveInteractiveTurnSettings` (streams) and `resolveBackgroundTurnSettings`
(everything unattended).

| Path | mode | model | effort | autoBuildout | Source of truth | Verified by |
|---|---|---|---|---|---|---|
| Global web (keyboard) | input ?? row ?? `auto` | input ?? row, **fit-clamped** | input ?? row | input ?? row → marker | row + request | `interactive-turn-settings.ts:67-76,85` · `global-root-turn.ts:182,437` |
| **Voice — all four legs** (wake · overlay · call · typed panel) | **`auto` forced**, row never read/written | `VOICE_TIER_MODEL` forced + fit clamp | `low` forced | **none** (no chips) | `contracts/chat/voice-tier.ts` | `interactive-turn-settings.ts:78-104` (one home for both `/root/turn` and `/sessions/:id/turn`) · `update-chat-session-settings.ts:44` refuses a PATCH |
| Workspace chat | input ?? row ?? `auto` | input ?? row, clamped | input ?? row | input ?? row → marker | row + request | `chat-turn.ts:331` |
| Spawned / agent DM | same | same | same | same | row (**birth-stamped**) | `session-turn.ts:105-111,347` |
| Spawned session **birth** | creator row's mode | creator row's model | creator row's effort | creator row's flag | ambient `x-vynel-turn-session` | `routes/sessions/index.ts:91-105` → `record-spawned-session-segment.ts:84-92` |
| Leaf session birth | **not written** (by design; the rail hard-codes `bypass-w-gate`) | model only | — | — | `map-agent-to-leaf-input.ts:34` | `record-leaf-session.ts:48-64` — recorded deferral |
| Delegation enqueue → job row | `x-vynel-delegation-mode` header, stamped **unconditionally** by all three streams + the delegated composer + the channel runner | tool arg | tool arg | *not carried* | `delegation_jobs` | `delegation-mode-header.ts:44-52` · `global-root-turn.ts:183` · `session-turn.ts:118-124` · `run-global-root-turn.ts:290` |
| `delegate-to-{workspace,spawned,agent}` | job ?? target row ?? `auto` | job ?? `agent.model` ?? target row, **fit-clamped** | job ?? target row | **target row** | `resolve-background-turn-settings.ts:57-102` | `run-task-job.ts:207-214` · `run-agent-run-job.ts:301` · `delegate-to-*.ts:160/178/169` |
| Agent-run job | same | `job ?? agent.model` **now clamped** | job ?? row (effort now enqueued) | target row | same | `enqueue-agent-run.ts:60,106` |
| Report / update / direct / system delivery (workspace) | requester row ?? `auto` | requester row, clamped | requester row | requester row → marker | `resolve-background-turn-settings` | `run-report-delivery-tick.ts:396-460` |
| Global delivery + note-to-global | global row ?? `auto` | global row, clamped | global row | global row | `run-global-root-turn.ts:266-283,448` | ditto |
| Channels (Telegram) | global row ?? `auto` (D1) | global row, clamped | global row | global row | same | same |
| **Schedule fire** | **hard-coded `bypass-with-behavior-gate`** | — | — | — | none | `fire-schedule.ts:139` — **T-1** |
| Continuation (interactive) | pinned to the checkpointing turn | ✓ | ✓ | ✓ (same input) | the genuine turn's closure | `run-global-root-turn-core.ts:108-114` |
| Checkpoint follow-up job | copied from the parent job (one shared spread) | ✓ | ✓ | via target row | `enqueue-checkpoint-continuation.ts:151-163` | `origin` still absent on the agent-run kind (deferred) |
| Swap segment | copy-forward, both homes | ✓ | ✓ | ✓ | predecessor | `record-swap-segment-session.ts:115` · `handle-session-started.ts:158` |

**Gaps, ranked:** T-1 (schedules) → the mode/model asymmetry in inheritance (a child inherits the
parent's **mode** via the header but the **target's** model/effort/autopilot — this *is* locked D4,
but it means an autopilot global turn's workspace delegation does **not** run autopilot, which will
surprise a user who "toggles Auto-buildout and walks away") → agent-run `origin` (deferred) → leaf
row hygiene (deferred).

**Locked semantics verified:** `DEFAULT_SESSION_MODE = 'auto'` is the single constant
(`session-mode.ts:82`) and no `?? 'ask'` survives in production. The voice tier is forced
server-side on both turn routes through one function, so a stale daemon build cannot reintroduce an
old pin. Children are birth-stamped. `tool arg ?? target row ?? default` holds in
`resolve-background-turn-settings.ts`. The autopilot marker is a *per-message* rider everywhere
(`compose-global-root-provider-message.ts:69-71`, `start-chat-turn.ts:184-189`,
`routed-turn-provider-input.ts:190`) — the decay-resistant shape the voice precedent established.

---

## 4. Missed improvements

1. **The checkpoint slot needs a supersede story, not just a durability story** (C-1). The arc moved
   the register to the row and stopped; the *semantics* of "one slot, last write wins" were never
   revisited against the new survivor concept it introduced. This is the single highest-value fix
   on the list and it is ~5 lines.
2. **The `autoContinue` flag is invisible to the model** (C-2). Three runner families promise
   something they do not do. The tool already has a "you cannot checkpoint here" branch — reuse it.
3. **Waiters have no bound; only holders do** (S-1). The arc's acceptance bar says "every
   approval/ask/lock/turn has a bound and an owner". `SessionTargetLocks.acquire` has neither.
   `turn-queued` is emitted once and never repeated, so a 40-minute wait is indistinguishable from
   a hang.
4. **`chainSegmentIdsOf` duplicates the fold's chain walk** (`overview/list-session-children.ts`
   vs `overview/fold-session-chains.ts`) — F flagged it itself and could not extract it. Two homes
   for the membership test that the arcs' arcs keep leaning on.
5. **The census guard is file-level, not call-site-level.** `continuity-census.test.ts:79-82`
   asserts set equality over *files*. `start-chat-turn.ts:267` wraps **conditionally** (a ternary on
   the continuing identity) and still counts as "wrapped". A future runner that wraps one of two
   call sites passes the guard. Cheap upgrade: count occurrences per file, not presence.
6. **No observability on held locks.** `busyKeys()` exists and `isRootTurnLockBusy` exists, but
   nothing exposes them — a wedged key is invisible until a user complains. A dev-only
   `GET /debug/locks` (or a periodic WARN naming keys held > N minutes) is a few lines and would
   have caught L1 in round 1 without an audit.
7. **`selectedModel` is both "the composer chip" and "the denominator source"**
   (`handle-usage-reported.ts:74-79`). Correct today, but it means the *meter* changes retroactively
   when a user flips the chip — the occupancy stays, the denominator moves. Worth a comment at
   least; the header explains the choice but not the consequence.
8. **The `x-vynel-delegation-mode` header carries only the mode.** Model, effort and autopilot ride
   the tool args (model/effort) or nothing (autopilot). If D4's "children inherit the creator's
   resolved settings" is meant to hold for delegations too, the header should carry the trio.

---

## 5. Monitoring binding + node display

*(Sub-audited; the load-bearing chains — the `begin` stamping table, the identity predicate and the
two chain-walk findings — I re-opened and confirmed myself.)*

### (a) The Nodes view

**Round-1 closure.** **N1 CLOSED** — the project level issues a scoped read
(`composables/nodes/use-project-nodes.ts:40-55` → `routes/sessions/schemas.ts:177-184` →
`get-sessions-overview.ts:60-71`, which curates **before** the cap) and feeds
`useSessionStatuses` its own entries. *Residual:* the client sends no `limit`, so
`DEFAULT_ENTRY_LIMIT = 50` still caps one room's dots, unpaged and unannounced, where
`useSessionsLibrary` pages the same op. **N2 PARTIAL** — see **NM-1**. **N3 CLOSED (a, c, d) /
PARTIAL (b)**: scratch buffers reconcile by id (`constellation-scene.ts:833-866` — positions,
spawn accumulators, orbiters, hover ring, particles), `NodesRace` uses the shared
`SCENE_STATUS_LABEL`, arcs resolve both endpoints through `nodeIdBySegmentId` built from
`entry.segments` **and** `continuing.segmentSessionIds`; `ORBIT_LANE_CAP = 8` keeps nodes on stage
but nothing prevents *overlap* (NM-4/5/6). **N4 PARTIAL — shaped, not shipped:** the union
(`constellation-node-ref.ts:19-62`), the level stack + registry (`node-level.ts:34-79`) and the
`detail` bag (`constellation-scene.ts:31-51`) all landed and are tested, but the registry holds
exactly two levels, `detail` is carried and never rendered (D7 defers the visual), and no level mints
a `global` or `voice` node.

**Slice-F claims:** `SceneNodeRef` one mint/one parse ✓ · level stack ✓ (a third level is
provably "one composable + one registry entry", `node-level.test.ts:58-78`) · `detail` bag
carried-not-rendered ✓ (declared) · count-aware layouts PARTIAL · `anchorOf` is a Map get ✓
(`constellation-scene.ts:207, 392-395`) · `segmentSessionIds` **required** on both continuing
payloads from one exported reader ✓ (`routes/chat/index.ts:185-186`, `routes/root/index.ts:90-91`) ·
voice modelled as a child of global ✓ in the ref model, never drawn.

**NM-1 · P2 · nodes — the answered-gate reaches the bar and the invitations, never the dots.**
`use-fleet-nodes.ts:36-43` builds every node with `?? "not_running"` → `idle`, and
`NodesView.vue:213` pushes `displayNodes` to the scene with no gate; Grid/Race print the word
**"Idle"** per row (`NodesGrid.vue:23`, `NodesRace.vue:29`). The comment at
`use-fleet-nodes.ts:71-72` — *"Both reads have answered, so a dot's COLOUR is a reading rather than a
guess"* — describes wiring that does not exist. Round-1's N2 was literally about the dots. Fix: gate
the render on `levelHasAnswered`, or add a pending state to the palette and the label map.
**CONFIRMED.**

**NM-2 · P2 · session/overview — `listSessionChainSegmentIds` silently returns a 1-element "chain"
past a 500-row window.** `list-session-children.ts:166` reads
`listAllChatSessionsForUser(db, { userId })`, whose cap is `OVERVIEW_LIST_LIMIT = 500` ordered by
`lastMessageAt desc` (`packages/chat/src/repositories/chat-sessions.ts:145-151`); `:168` then
`if (!byId.has(session.id)) return [session.id]`, and `:184` breaks on a parent outside the window
(a silent suffix). Hidden swap segments consume the window too. Downstream this truncates
`segmentSessionIds` on **both** continuing payloads — so the node screen's arcs drop pre-swap
endpoints again, the exact bug slice F was built to fix — and `listSessionChildren` misses every
child enqueued on a pre-window segment. `foldSessionChains:33` shares the call and the window.
Fix: walk the chain by `continuedFromSessionId` in SQL, or give this reader its own uncapped
user-scoped fetch. **CONFIRMED** — sub-auditor's probe returned `{ chainLength: 4, returned: 1 }`
for a 4-segment chain behind 520 newer conversations; I re-read the cap and both break conditions.

**NM-3 · P2 · session/overview — the two chain homes disagree on a forked chain, and the newer
one returns the *other* fork's segments.** `list-session-children.ts:191-201` walks forward from the
head via the newest-claimant map and then, when the forward walk stepped past the asked-about
segment, **appends it last** (`if (!seen.has(session.id)) ids.push(session.id)`) — which both breaks
the function's own "OLDEST first" docstring (`:161-164`) and hands back the winning fork's segments
plus the orphan. Sub-auditor's probe on a `HEAD → {NEWER, ORPHANED}` fork:
`listSessionChainSegmentIds(ORPHANED)` → `["HEAD","NEWER","ORPHANED"]`, and
`listSessionChildren(ORPHANED)` returned **a different conversation's** children. The shipped test
asserts only `toContain`, so the pollution passes. This is the concrete cost of the two-homes
duplication F flagged and could not extract (§4.4). Fix: when the forward walk did not reach the
asked-about session, answer with its own backward lineage only. **CONFIRMED (probe + code read).**

**NM-4/5/6 · P3 · nodes — layout overlap past the counts a busy install produces.** Constellation
rings are spread over `[0.7, 1]` of `ry ≤ 300` with `ceil(n/12)` rings, so at 37+ nodes adjacent
rings are ~30px apart against a 52px node plus a 37px label (`constellation-layout.ts:132, 145-170`)
· `riseStep`'s count-aware clamp guarantees the band is exactly filled, so past ~29 nodes the 49.7px
step is *always* under the node diameter (`:118-124`) · orbit lane-mates share a lane but rotate at
`(1.7 − i·0.13)`, so they drift into each other, and from `i = 14` the factor is **negative** —
those nodes orbit backwards, falsifying the "golden angle keeps lane-mates apart" comment at `:94-95`
(`constellation-scene.ts:262-271`). Also `ORBIT_LANE_CAP = 8` was derived against the raw
1600×900 stage, ignoring the ~66px of layout-pill/hint furniture (`NodesView.vue:300-344`).
**PLAUSIBLE (arithmetic) / CONFIRMED by reading (the negative speed).**

**NM-7 · P3 · nodes — nothing prunes the level stack against the fleet** (`NodesView.vue:68-79`):
drill into a project, archive it elsewhere, and the level keeps polling and offers "Open the chat"
for a room that no longer exists. **PLAUSIBLE.**

**What still blocks enlargement — concrete.**
*A third level:* the server half is complete and has **zero client consumers** —
`GET /sessions/:sessionId/children` (`routes/sessions/index.ts:587-617`), `listSessionChildren`,
the `SessionChildren` contract, the SDK method and 431 lines of tests. What is missing is a
`useSessionNodes()` composable, one registry line at `NodesView.vue:114`, and a **status mapping**:
`SessionChildStatus` includes `'queued'`, which has no home in the five scene states
(`node-status.ts:26-40`) or the five bar chips (`NodesFleetBar.vue:44-50`), and a child `session`
row carries `status: null` by contract, so it must be married to `useSessionStatuses` — whose key is
the chain *tail*, not the child handle. *More nodes:* `parentSceneNodeKind` models voice-under-global
but no level mints a `global` or `voice` node, and all three layout functions are flat index→slot
with no notion of hierarchy; `message-scene-mapping.ts:40-44` anchors only on `workspaceId`, so a
global/voice endpoint always resolves to the core. *More info per node:* `detail` carries `note` and
`tasksDone/Total` and reserves `elapsedMs` + `childCount`, which have **no producer** — the former
would come from `activity.serverTurnForSession(...).startedAt`, the latter from the uncalled children
route.

### (b) The wider live binding

**Every production `activityFeed.begin` and what it stamps** (re-verified by me):

| # | Call site | `scopeKind` | `primarySessionId` | `origin` |
|---|---|---|---|---|
| 1 | `streams/chat-turn.ts:431-437` (workspace chat) | `workspace` + id | **never** | `web` |
| 2 | `streams/global-root-turn.ts:334-339` (global/voice) | `voice` or `global` | **always** | `voice`/`web` |
| 3 | `streams/session-turn.ts:447-459` (spawned/agent DM, call leg) | `workspace` + id when `spawned.workspaceId !== null`, else `global` | **always** (`spawned.id`) | `voice`/`web` |
| 4 | `sessions/run-global-root-turn.ts:404-424` (channels, deliveries) | `global` | **always** (folded in `b71561c1`) | channel/`web` |
| 5 | `sessions/build-schedule-fire-deps.ts:55-65` (schedule fire) | `workspace` + id | **never** | `schedule` |
| 6 | `delegation/run-task-job.ts:157-175` | `global` for a session target, else `workspace` + id | only for a session target | `delegation` |
| 7 | `delegation/run-agent-run-job.ts:118-131` | `global` if no workspace, else `workspace` + id | only when `targetPrimarySessionId !== null` | `delegation` |
| 8 | `delegation/run-report-delivery-tick.ts:253-262` (direct delivery) | `global` | never | `delegation` |
| 9 | `delegation/run-report-delivery-tick.ts:321-333` (workspace notify) | `workspace` + id | never | `delegation` |

**NM-8 · P2 · api + web — the "a workspace turn names no primary" invariant is broken at site 7, and
pinned by nothing.** `matchTurnToIdentity({ kind: 'workspace' })` is *defined* as
`scopeKind === 'workspace' && workspaceId === X && primarySessionId === null`
(`composables/activity/match-turn-to-identity.ts:45-49`). Sites 1, 5, 6 and 9 satisfy it and all
genuinely resume the room's continuing thread — **except site 5** (a schedule fire always starts a
FRESH session, `fire-schedule.ts` "Schedules always start a FRESH session (resumeSessionId omitted —
D3)") and **site 7 on its null path**. That null path is reachable:
`sessions/composer-mention-turn.ts:147-156` catches a failed colleague resolve, **logs and
continues**, and `:187` then omits `targetPrimarySessionId`; `enqueue-agent-run.ts:44-48` documents
the null column. `run-agent-run-job.ts:120-128` then stamps `{workspace, workspaceId,
primarySessionId: null}`.

*The bug is the BINDING half.* `useContinuingSessionId` for a workspace scope resolves
`runningPrimarySessionIdFor({kind:'workspace', workspaceId})`
(`composables/chat/use-continuing-conversation.ts:60-64` → `stores/activity-store.ts:83-89`) and uses
it whenever the room's primary has no `currentSdkSessionId` yet — i.e. a room that has never
completed a turn. In that window an unbound agent-run (or a schedule fire) hands the room's chat
**that run's** session id — a *different conversation's* transcript rendered as the room's — and the
sticky `lastRunningId` (`:54, 71-77`) keeps it after the turn ends. That is precisely the round-1 V2
class the arc's one predicate was built to kill, reached through a different door.
`run-task-job.ts:159-161` gets this structurally right: its workspace branch is reachable *only* when
`targetPrimarySessionId === null`, which is exactly a turn on the room's continuing thread.

*The STATUS half is arguably correct and is not part of this finding.* `use-session-statuses.ts:64-69`
marking the room "working" while a schedule fires in it is defensible — something genuinely is
running in that room. Only the binding must not cross.

*Minimal fix (binding only).* (a) never stamp `scopeKind: 'workspace'` without a `primarySessionId`
in `run-agent-run-job.ts` — resolve the colleague before `begin`, or announce as `global`;
(b) make the mention loop fail loudly instead of enqueuing an unbound agent-run; (c) for the schedule
fire, either stamp the room's primary id or have `useContinuingSessionId`'s fallback skip
`origin === 'schedule'`. **CONFIRMED by tracing** (both producers and the whole consumer chain read
end to end).

**NM-9 · P2 · testing — nothing pins the invariant at the producer.**
`match-turn-to-identity.test.ts` builds its own fixtures and pins only the predicate; a grep for
`activityFeed`/`turn-started` in `streams/chat-turn.test.ts` (985 lines) returns nothing, and no
suite asserts any of the nine `begin` payloads. The arc's own §6 flagged this invariant as fragile
and it is enforced by comments alone. One fake-feed test per producer would have caught NM-8.
**CONFIRMED.**

**Verified clean (do not re-spend budget):** `scopeKind: 'voice'` survives end to end — begin →
`SessionActivityFeed` → `SessionTurnScopeKind` union → `buildSessionTurnRecorder` →
`session_turns.scopeKind` (a plain `text()` with no CHECK, which is why 0050 correctly needed no
migration for it) → live channel → store → predicate; the voice wall on the overview holds
(`listableChains` is shared by the list *and* the count, and `getVoiceChatOverviewEntry` is the only
other `foldSessionChains` consumer); the Voice menu row runs the *same* ladder through its own
non-`x-mcp` door; the shell light folds global ∪ voice in a documented third-place-that-is-not-a-third-home
(`components/shell/global-area-status.ts:29-36`); `globalStatusView` **feeds**
`use-workspace-status.globalStatus` rather than duplicating it; the three private liveness predicates
really did collapse into one (the remaining raw scans are session-**id** equality, not inference);
D3's interrupt is owner-checked and scope-gated with the client refusing to send an empty body from
a voice surface; D5's `/activity/running` + `listRunningTurns` are gone with no dangling SDK method;
`desktop-activity-fold.ts` carries and retargets `sessionId`/`primarySessionId` so the overlay's Stop
routes by identity.

**Two residuals worth naming:** `search_chat_messages` walls the **global** scope
(`packages/chat/src/history/search-chat-sessions.ts:29-31, 46`) and has no explicit `voice` branch —
voice segments are `visibility: 'hidden'`, so it is probably unreachable, but it is the one door
where the voice wall is implicit rather than stated (P3). And `GlobalChatView.vue:212-216` gates its
transcript poll on `hasGlobalServerTurn`, which includes voice via `isTurnInGlobalArea` — a running
voice turn makes the Global transcript poll at 4 s. Wasteful, not incorrect (P3).

---

## 6. Session continuity everywhere

**Coverage is complete and now structurally enforced.** Independent census (my own grep, not the
test's): exactly **5** production `consumeSessionEventStream` call sites —
`delegate-to-agent-session.ts:185`, `delegate-to-spawned-session.ts:201`,
`delegate-to-workspace-root.ts:195`, `run-global-root-turn-core.ts:281`, `start-chat-turn.ts:242` —
and exactly **5** `withBoundaryContinuity` sites in the same five files. The guard
(`continuity-census.test.ts`) recomputes rather than hard-codes, so it does not go stale; its one
weakness is file-level granularity (§4.5).

**Where it can break, ranked:**

1. **C-1 — the single-slot register.** The arc's headline durability fix works (a checkpoint
   survives a restart, a follow-up job's hand-over survives a restart, the depth cap keeps counting
   across a restart — all pinned by `pending-checkpoints.test.ts`), but the survivor is destroyed by
   the next checkpoint on the same identity. Reproduced.
2. **C-2 — the promise the model makes on `autoContinue: false` turns.** Continuity's *user-visible
   contract* is broken even though the mechanism is fine.
3. **Lock scope is right; the queue behind it is not** (S-1). A boundary swap runs inside the root
   lock / target lock, so no swap ever races the next turn — the round-1 L1 break is gone. The
   remaining cost is wait time.
4. **The denominator is now durable and chosen-model-first** (`handle-usage-reported.ts:74-79`,
   copied forward in both swap homes, read through one helper by the pressure detector
   (`apply-primary-turn-continuity.ts:135`), the fit guard (`fit-pinned-model-to-session.ts:68`),
   whoami (`resolve-whoami-report.ts:126`)) — with the overview's hand-rolled twin as the one
   drifting reader (**M-3**).
5. **The carry tail no longer truncates on one long line** (`build-continuity-context.ts:155-183`) —
   it skips and leaves an `[… N messages omitted here …]` marker so the tail never implies an
   adjacency that did not happen. G4 fully closed.
6. **A checkpoint section can appear in a delivery segment's carry.** `buildContinuityContext:133-138`
   peeks the slot unconditionally, so a swap that happens *during* a delivery turn seeds the fresh
   segment with "CHECKPOINT: … the next step you named: X" for a step that turn will then drop.
   Cosmetic incoherence; P3.
7. **Voice + global still share one cwd** for concurrent seeded swaps — unexamined again this round
   (it is a live-smoke item, not a code question).

**Improvements:** the supersede fix (C-1); per-call-site census; a `ChatTurnEvent` for the
dropped-checkpoint note so a live client sees it without a refetch (recorded deferral — it matters
more now that the note is the *only* evidence of a lost step).

---

## 7. Score — **8.5 / 10** (round 1: 7)

| Axis | R1 | R2 | Why it moved |
|---|---|---|---|
| Correctness | 6.5 | **8** | The three silent loss/leak classes are gone *with tests that name their incidents* (L1's lock lifetime, G2's mark-on-`session-started`, V2's identity-shaped feed). Against that: **C-1** is a new silent-loss class in the flagship feature, **VN-1** is a shipped double-speak regression, **NM-8** re-opens the identity-aliasing class through a different producer. |
| Stuck-resistance | 5 | **8.5** | The biggest single jump. One `startPausableTimeout` now backs *every* bound in the system, the delegated cap actually cancels-and-awaits instead of abandoning, claims carry a heartbeated lease with a sweeper that shares the boot pass's policy, terminal writes are a CAS on the claim, asks got a reaper, a queued global delivery yields its slot. Held back by **S-1** (waiters have no bound at all) and **T-1** (schedule fires have none either). |
| Settings integrity | 6.5 | **8.5** | One resolver, one default (`auto`), the mode stamped unconditionally by all four producers, children birth-stamped, `autoBuildout` read by every runner but one, the fit guard at three sites covering every path. Held back by **T-1** (schedules reached none of it) and by the default's un-traced consequences — **T-2** (the product contract) and **T-3** (desktop plan authority moved in a different package). |
| Observability | 7 | **8** | `scopeKind ∈ {global, workspace, voice}` + `primarySessionId` on the wire, one `matchTurnToIdentity`, a voice status with its own door and its own mark, `turn-queued{busy}`, the identity-shaped interrupt, `/activity/running` retired. Held back by **NM-1** (dots still paint confident grey), **NM-9** (no producer pins the invariant), and no lock/held-key observability anywhere. |
| Continuity | 8 | **8** | Real gains — durable checkpoints across a restart, a durable depth cap, a persisted denominator four readers agree on, a carry tail that skips instead of truncating, a census guard that recomputes. Exactly cancelled by **C-1** + **VN-6**: the single-slot register makes the headline feature lossy in its likeliest scenario. Net flat. |
| Voice | 5.5 | **7.5** | The envelope is finished: tier forced server-side through one function on all four legs, no card of any kind, no `ask_user`, no PATCH, own scope on the wire, own status, Stop reaches its own thread, a watchdog + abort + connect deadline. Then **VN-1** double-speaks every reply in the shipped default config, and **VN-2** can answer a question with silence. |
| Tests | 7.5 | **8.5** | The `apps/`↔`packages/` seams round 1 called untested now have suites that pin the incident: lock lifetime under a cap, cap-suspends-on-park, lease heartbeat, capped-delivery-is-recoverable, notify-retry lands exactly one row, wall clock on fake timers, continuity census, voice fold, identity match. Missing: producer-side feed assertions (**NM-9**), per-call-site census. |
| Code health | 8 | **8.5** | The 911-line tick is 226 with three named siblings; the 503-line root routes are four files; the WHY-comments still carry their incident dates; §6/§7 of the arc note is an unusually honest engineering record. Against: `run-task-job.ts` at 415, two homes for the chain walk (**NM-3** is what that costs), a handful of comments that describe wiring that does not exist (`use-fleet-nodes.ts:71-72`, `constellation-layout.ts:94-95`). |

**Why 8.5 and not the 9+ Kafi asked for.** Every round-1 P1 is genuinely closed, most with a
regression test — that alone is worth the jump. What holds it under 9 is four things, each small and
local (the same shape as round 1's list):

1. a **P1 regression the arc itself shipped** (VN-1: the E3 coupled fix publishes to the wrong
   window, so every spoken reply plays twice in the default config);
2. a **P1 correctness hole in the arc's own headline feature** (C-1: the restart survivor is silently
   destroyed by the next checkpoint — and one of Kafi's live smokes will pass or fail by luck);
3. a **stated assumption silently not delivered** (T-1: schedule fires are still hard-coded
   `bypass-with-behavior-gate` with no bound and no settings, while §2 said they would resolve
   `?? DEFAULT`);
4. the **one invariant the builders flagged as fragile** is broken at a producer and pinned by no
   test (NM-8/NM-9).

**+0.5 (→ 9.0), all local, all ≤ half a day each:** C-1's supersede-with-a-note · VN-1's
`publishSpeakTo(findWakeTarget())` · T-1's `resolveTurnSessionSettings` + wall clock + an in-flight
guard on the schedule fire · NM-8's "never stamp `workspace` without a primary" + NM-9's nine
producer assertions · C-2's `autoContinue`-aware checkpoint tool · T-3's explicit-pick gate on
`deriveDesktopPlanConsent`.

**+1.0 more (→ ~9.5–10):** bound and abort the waiter (S-1) · one home for the chain walk, uncapped
(NM-2/NM-3) · render the answered-gate and the `detail` bag · ship the third node level (the server
half is already built and unused) · lock/held-key observability (a WARN naming a key held past N
minutes would have found L1 without an audit) · resolve T-2 as a product decision.

---

## Round-1 P1 closure table

| ID | Round-1 P1 | R2 verdict | Where it is closed / how it is not |
|---|---|---|---|
| L1 | Delegation timeout releases the target lock under a live turn | **CLOSED** | `route-request.ts:99-156` cancels + awaits; `run-delegation-claim-and-run-tick.ts:159-167`; test "two jobs on one target never run concurrently" |
| V1 | Voice CALL leg runs `ask`, pins persisted, no clamp | **CLOSED** | `interactive-turn-settings.ts:67, 78-104`; `session-turn.ts:106-112, 303`; `call-session-client.ts:43-49` |
| V2 | Voice announces as global with no primary id | **CLOSED** | `global-root-turn.ts:334-339`; `contracts/chat/session-activity.ts:34`; `match-turn-to-identity.ts` |
| V3 | Voice chain has no status anywhere | **CLOSED** | `fold-session-chains.ts:73` + `get-sessions-overview.ts:46, 89-93` + `routes/root/voice-chat.ts` + `global-area-status.ts:29-36` |
| W1 | Card-less surfaces park unbounded | **CLOSED for voice/channels/delegation · OPEN for schedule fires** | `tool-approval-policy.ts:56-58`; `global-root-turn.ts:217-227`; `turn-wall-clock.ts` — vs `fire-schedule.ts:139` (**T-1**) |
| G1 | A parked ask wedges the root lock forever | **CLOSED (bounded ~2 h, not eliminated)** | `env.ts:72-88`; `asks-recovery-service.ts`; `run-report-delivery-tick.yield.test.ts` |
| G2 | Catch-up marked surfaced before the turn starts | **CLOSED** | `run-global-root-turn-core.ts:260-271, 344-356` |
| V4 | Voice Stop interrupts the global primary | **CLOSED** | `routes/root/interrupt.ts:34, 60-73`; `use-chat-turn.ts:308-312`; `DesktopControlOverlayView.vue:124-148` |
| M1 | Fit guard has one caller | **CLOSED** | `interactive-turn-settings.ts:85` · `resolve-background-turn-settings.ts:77` · `run-global-root-turn.ts:270` |

**Round-1 P2s:** S2, V5, V6*, V7, D1, D2, T1, T3, T4*, N1, N3 **CLOSED** · S1, C1, T2, N2, N4
**PARTIAL** (each with a named residual above) · nothing STILL OPEN untouched.
*V6 closed the no-op but introduced VN-1; T4 closed everywhere but schedules.

**Round-1 P3/latent list: NOT re-swept end to end.** Three of its items were checked because they sat
on paths I traced and all three are closed — the two bare writes
(`settle-failed-delegation-attempt.ts:111-116`), the carry tail's early `break`
(`build-continuity-context.ts:155-183`), and `mapFrameToBrainEvent`'s recoverable-as-failed
(`run-brain-turn.ts:38-47`). The rest of that list (the fail-open unpersisted approval branch,
`continueEnabled:false`, `createApp`'s `??`-defaulted registries, the targetless colleague enqueue,
the contradictory continuation anchor attribution, the mid-turn compaction split, the shared voice/global
cwd) was **not** re-verified this round.

---

## Top 10 ranked

| # | ID | Sev | One line | Where | Status |
|---|---|---|---|---|---|
| 1 | **VN-1** | P1 | A handed-off `speak` is published to the window that does not own the session — every spoken reply plays twice in the shipped default config (a regression: the pre-arc branch was a no-op) | `apps/voice/src/overlay/overlay-channel.ts:229-241` vs `:90-99` · `apps/voice/src/main.ts:156` | CONFIRMED (reproduced) |
| 2 | **C-1** | P1 | The single-slot checkpoint register silently destroys a restart survivor when the next turn checkpoints — the flagship durability feature is lossy in its likeliest scenario | `packages/session/src/continuity/pending-checkpoints.ts:74-87` · `runtime/run-turn-with-continuations.ts:80-124` · `delegation/run-report-delivery-tick.ts:499-511` | CONFIRMED (reproduced) |
| 3 | **NM-8** | P2 | An unbound agent-run (and a schedule fire) announces as the ROOM's own thread, so a pre-bridge workspace chat can bind to it — round-1's V2 class through a different producer | `packages/session/src/delegation/run-agent-run-job.ts:120-128` · `apps/local-api/src/sessions/composer-mention-turn.ts:147-156, 187` · `apps/local-web/src/composables/chat/use-continuing-conversation.ts:60-64` | CONFIRMED (traced) |
| 4 | **T-1** | P2 | Schedule fires are the one runner D3/D8 never reached: hard-coded `bypass-with-behavior-gate`, no model/effort/autopilot, and no turn bound of any kind | `packages/schedules/src/firing/fire-schedule.ts:139` | CONFIRMED |
| 5 | **C-2** | P2 | Every turn is told "Vynel will continue you automatically"; voice, delivery and note turns never do — on voice the user hears the promise and then silence | `packages/session/src/mcp/session-mcp-feature-descriptor.ts:27-33, 64` · `mcp/checkpoint-tool.ts:66-72` | CONFIRMED |
| 6 | **NM-2** | P2 | `listSessionChainSegmentIds` reads a 500-row window, so past it a chain answers as a single segment — silently truncating `segmentSessionIds` on both continuing payloads and every children read | `packages/session/src/overview/list-session-children.ts:166, 168, 184` · `packages/chat/src/repositories/chat-sessions.ts:145-151` | CONFIRMED (probe) |
| 7 | **S-1** | P2 | The interactive queue wait is unbounded and uncancellable — only the *holder's* 60-minute cap limits it, `turn-queued` is emitted once, and a disconnect still takes the lock | `packages/session/src/delegation/session-target-locks.ts:28-35` · `streams/chat-turn.ts:550` · `streams/session-turn.ts:281` | CONFIRMED |
| 8 | **VN-2** | P2 | The native voice leg has no "the model never called `speak`" net (the overlay leg does) — a decayed directive answers the user with total silence | `apps/voice/src/loop/voice-session-driver.ts:291-309` vs `voice-turn-adapter.ts:29-35` | CONFIRMED |
| 9 | **T-3** | P2 | The same `auto` default silently moved desktop plan authority from `display-only` to `standing-consent` for users who never picked a mode — a different package, not in D3's consequence row | `packages/desktop-control/src/plan/desktop-plan-consent.ts:19-23` · `streams/global-root-turn.ts:292` · `streams/session-turn.ts:210` | CONFIRMED |
| 10 | **NM-3 / NM-9** | P2 | The chain walk has two homes that disagree on a forked chain (one returns the other fork's children) · and no test pins the `begin` payload of any of the nine producers | `overview/list-session-children.ts:191-201` vs `overview/fold-session-chains.ts:39-53` · `streams/chat-turn.test.ts` (no feed assertions) | CONFIRMED (probe + read) |

Runners-up: **VN-3/VN-4** (a watchdog-abandoned turn's late reply arrives unlabelled, or collides on
the call speaker) · **T-2** (`CLAUDE.md:4` still promises "an approval card on every irreversible
action"; the default no longer does) · **NM-1** (the answered-gate never reaches the dots) ·
**VN-5** (a call participant reaches uncarded desktop actions once enabled) · **VN-6** (a voice
survivor is neither continued nor dropped, forever) · **M-1** (a starved heartbeat can deliver a
message twice) · **M-3/M-4** (the denominator's second home; the one timer that does not unref).

---

## 8. Voice session review

*(Sub-audited; every load-bearing citation below I re-opened myself — the P1 chain end to end.)*

### The trace as it exists today

| Hop | Where | What it forces |
|---|---|---|
| wake → handoff decision | `apps/voice/src/main.ts:235` `shouldHandOff: () => jarvisEnabled \|\| overlay.hasClient`; `apps/voice/src/env.ts:85` `VYNEL_VOICE_JARVIS_WINDOW` **defaults to `'1'`** | **handed-off is the default path**; the native `#runTurn` is the exception |
| driver turn + watchdog | `loop/voice-session-driver.ts:250-287` · `loop/turn-watchdog.ts:25-55` | `busy`; `VYNEL_VOICE_TURN_WATCHDOG_MS` = 300 000 ms, unref'd |
| brain stream | `brain/run-brain-turn.ts:68, 81-95, 137-169` | AbortController chained to the watchdog + a 10 s connect deadline |
| POST body | `run-brain-turn.ts:179-189` · call leg `call/call-session-client.ts:43-49` | both send `{mode: VOICE_TIER_MODE, voice: true}` + the tier model/effort |
| `/root/turn` voice leg | `streams/global-root-turn.ts:146-150, 168-182, 217-227, 334-339, 401-406, 444-446` | voice primary; **tier forced, row never read or written**; **no `ask_user`**; `scopeKind:'voice'` + `primarySessionId`; `turn-queued` probe on `${userId}:voice`; `autoContinue: false` |
| core | `runtime/run-global-root-turn-core.ts:95, 239-245, 307-310` | lock `${userId}:voice`; **no context nudge**; hidden `'voice'` segment; `withBoundaryContinuity` still applied (`:325`) |
| provider message | `runtime/compose-global-root-provider-message.ts:56-68` | catch-up **skipped** on voice (deliberate — the collector is a one-way user-wide latch); the voice per-message marker appended |
| reply | model calls `speak` → `routes/voice/index.ts:86-103` → **always** `speakThroughDaemon` | the server does not know which client started the turn |
| four-party router | `apps/voice/src/main.ts:154-173` | handed-off → `overlay.publishSpeak` (native fallback); asleep + client → `publishSpeak`; else native |
| call leg | `streams/session-turn.ts:106-112, 186-218, 275-281, 419-441` · `apps/voice/src/call/call-conversation.ts:200-252` | tier forced, no write; **desktop server composed**; per-session lock (never the voice root lock); interactive wall clock; the daemon watchdog hands the room back **without aborting the read** |

### Round-1 voice closure

V1 **CLOSED** · V2 **CLOSED** · V3 **CLOSED** (with the documented deviation: the shared overview
drops voice unconditionally and the Voice surface reads its own door — safer than the planned
per-consumer filters) · V4 **CLOSED** (and the client sends *nothing* rather than an empty body
when it has no session id: `use-chat-turn.ts:308-312`) · V5 **CLOSED** · **V6 PARTIAL — see VN-1** ·
V7 **CLOSED** (`update-chat-session-settings.ts:44-48` throws `ForbiddenError` on a voice row) ·
W1 **CLOSED** for voice (`auto` stands the floor down *before* `isAlwaysCardTool` is consulted —
`tool-approval-policy.ts:56-58, 107-108` — so nothing cards at all; no `ask_user`; watchdog + abort
+ connect deadline; `turn-queued` → a spoken "One moment", `voice-session-driver.ts:297-302`) ·
`mapFrameToBrainEvent` **CLOSED** (`run-brain-turn.ts:38-47`).

### NEW voice findings

---

**VN-1 · P1 · voice · REGRESSION INTRODUCED BY THIS ARC — a handed-off `speak` is published to the window that does not own the session, so every spoken reply plays twice**

*Where.* `apps/voice/src/overlay/overlay-channel.ts:229-241` (`publishSpeak`) vs `:90-99`
(`findWakeTarget`) · `apps/voice/src/main.ts:154-162` · `apps/voice/src/main.ts:178`
(`wakeSurface: jarvisEnabled ? 'jarvis' : 'any'`) · `apps/local-web/src/components/shell/AppShell.vue:786`
· `apps/local-web/src/composables/voice/use-voice-daemon-link.ts:86` (surface defaults to `"app"`).

```ts
// overlay-channel.ts — the wake picks an ELIGIBLE client…
const findWakeTarget = () => { for (const [s, surface] of subscribers) if (isWakeEligible(surface)) target = s; … }

// …the speak picks the newest client of ANY surface
publishSpeak(text: string): boolean {
  let target: SSEStreamingApi | null = null
  for (const stream of subscribers.keys()) target = stream   // ← no surface filter
```

*Failure scenario, traced hop by hop in the shipped default config.* `VYNEL_VOICE_JARVIS_WINDOW='1'`
→ `wakeSurface: 'jarvis'` and `shouldHandOff` always true. The Tauri build opens both windows, and
`AppShell.vue:786` mounts `<VoiceOverlay/>` unconditionally, so the daemon has **two** subscribers
(`jarvis` and `app`) — the relay holds one upstream per surface. The wake goes to the jarvis window,
which runs the turn and plays each `speak` **locally** off its own SSE stream
(`voice-turn-adapter` → `voice-command-session.ts:97-105`). The same `speak` tool call *also* goes to
the server's one and only speak door (`routes/voice/index.ts:103` — it has no idea a browser started
the turn), which POSTs the daemon, which takes the `isHandedOff` branch, which calls `publishSpeak`
— landing on whichever webview subscribed **last**. When that is the app window, its
`isPlayingOwnTurn()` is false and it plays. **Two browser speakers on one machine, on every reply.**
Ordering is a boot race between two webviews and flips on any app-window reload, which is exactly
why a smoke can pass.

*Why it is a regression.* Before the arc the `isHandedOff` branch only logged
(round-1 V6, "the dead `onSpeak` branch"), so nothing double-played. §6's E→B note predicted this
precisely — *"publishing there would double-play every spoken reply in the shipped config"* — and
prescribed the coupled fix. Both halves shipped, but the `isPlayingOwnTurn` guard can only protect
the window that owns the turn, and `publishSpeak` does not target that window.

*Minimal fix.* Route the handed-off branch to the handoff owner: a `publishSpeakTo(findWakeTarget())`
(mirroring `deliverWake`), or a surface argument on `publishSpeak`. The relay's newest-within-surface
pick is already correct once the surface is. The `isPlayingOwnTurn` half stays.

**CONFIRMED** — sub-auditor reproduced the targeting against the real overlay channel
(*"wake owner (jarvis) got speak: false | non-owner (app) got speak: true"*); I re-read the whole
chain (server door → daemon router → channel target → both web mount sites).

---

**VN-2 · P2 · voice — the native leg has no "the model never called `speak`" net; the overlay leg does**

`loop/voice-session-driver.ts:291-309` ignores `text` deltas entirely and returns on `completed`;
`apps/local-web/src/composables/voice/voice-turn-adapter.ts:29-35` speaks
`toSpokenGist(textAnswer)` when the turn produced no `speak`. The instruction file itself warns the
model that *"a turn with no `speak` call is silent to the user"*
(`packages/instructions/session-instructions/voice-turn.md:2`) — the per-message marker exists
because that directive decays. On the native leg the user asks a question and hears **nothing**, with
no failure notice and no status anywhere. Fix: port the gist fallback into `#consumeBrainTurn`
(`@vynel/voice` already exports `toSpokenGist`). **CONFIRMED.**

---

**VN-3 · P2 · voice — after the watchdog fires, the abandoned turn's answer arrives later, unlabelled, interleaved with the next question**

`voice-session-driver.ts:272-281` hands the room back and speaks "Still working on that"; the abort
frees only the socket — the server's own contract is explicit that a disconnected client's turn
*"still resumes and runs the turn TO COMPLETION"* (`streams/session-turn.ts:510-517`). The
`${userId}:voice` lock is still held, so the user's next utterance gets
`turn-queued{busy}` → "One moment" → parks. The heard sequence is: *"Still working…"* → [asks B] →
*"One moment."* → **[answer to A]** → [answer to B], with nothing naming which question is being
answered and no screen to disambiguate. Fix: stamp the abandoned utterance on the watchdog and
prefix the first late line ("About your earlier question — …"). **CONFIRMED** (trace).

---

**VN-4 · P2 · voice (call) — two overlapping call turns collide on one `LineSpeaker`; the loser is silently dropped**

`packages/voice/src/relay/line-speaker.ts:51-54` throws *"speakLine while a line is in flight — the
caller must serialize speech"*; the call watchdog clears `#turnInFlight`
(`apps/voice/src/call/call-conversation.ts:206-221`) while the abandoned turn keeps reading
(`call-session-client.ts:43-49` passes no signal), so a follow-up utterance starts turn 2 and both
replies reach `#speak` (`:247`). The catch at `:296-300` swallows the throw as *"call speech failed
— the line was not heard"*, and the dropped line has already polluted the echo memory (`:291-293`).
A live participant hears silence where an answer was promised. Fix: serialize `#speak` behind one
promise chain (the folder already has `serializeAsync`). **CONFIRMED** (code read; not exercised on a
live call).

---

**VN-5 · P2 · voice (call) · security posture — a live-call participant drives the desktop uncarded once actions are enabled**

`streams/session-turn.ts:186-218` composes the desktop server for every non-agent spawned session,
including a call session, and passes `desktopPlanConsent: deriveDesktopPlanConsent(turnPermissionMode)`
(:210). The call turn's mode is the voice tier's forced `auto`, and
`packages/desktop-control/src/plan/desktop-plan-consent.ts:21-23` maps `auto` → `standing-consent`;
`approvalFloorStandsDown('auto')` returns `allow` before any card check
(`tool-approval-policy.ts:56-58, 107-108`). The code's own comment says *"The user IS here on this
path — typing into the session, **or speaking on a live call**"* — so this is a deliberate stance,
but the person speaking on a call is not necessarily the machine's owner. Mitigated today by
`VYNEL_DESKTOP_ACT_ENABLED` defaulting to `'0'` (`apps/local-api/src/env.ts:98-101`). Fix (if the
stance is wrong): exclude the desktop descriptor when `input.voice === true` on the session-turn
path, or force `'display-only'` there. **CONFIRMED at the policy level.**

---

**VN-6 · P3 · voice — a checkpoint that survives a crash on the voice thread is never continued AND never dropped**

`runtime/run-turn-with-continuations.ts:91-97` — the `autoContinue === false` survivor exemption
no-ops the drop, and `:104-107` then `break`s. Voice is *always* `autoContinue: false`, so a
checkpoint marked during a voice turn that the process died inside is pending forever: every
subsequent voice turn re-logs *"a pending checkpoint survived from before this turn — it continues
after it"* and continues nothing. The exemption exists for **delivery** turns riding a continuing
identity that *does* continue; the voice thread never does. This is the mirror image of **C-1** —
same single-slot register, opposite failure. Fix: the survivor exemption should key on "this
identity has a continuing runner", not on the flag. **CONFIRMED** (code read).

---

**VN-7/8/9 · P3.** A queued **call** turn produces no spoken notice (`call-conversation.ts:226-236`
handles only `text`/`failed` where the wake leg says "One moment") · a deliberate **Stop** is
announced as a failure (`run-brain-turn.ts:48-50` maps `session-interrupted` → `failed` → the driver
speaks "Sorry, I ran into a problem with that", `voice-session-driver.ts:32,286`) · the
`voice:<surface>` live channel is authorized for **any** user (`live/live-channel-route.ts`,
`case 'voice': return true`) while every other kind is ownership-checked — harmless in Phase 1, a
Phase-2 trap on a channel that carries wake commands and spoken text. **CONFIRMED.**

**VN-10 · P3 · PLAUSIBLE.** The daemon's 10 s connect deadline (`run-brain-turn.ts:68`) is measured
against a route that does six dynamic imports plus full MCP composition *before* it opens the stream
(`global-root-turn.ts:194-305`). On a cold API the first voice turn can trip it: the daemon speaks
"the brain did not answer within 10s" while the handler runs the turn anyway. Cold-start smoke item.

### Ranked voice improvements

1. **VN-1** — target `publishSpeak` at the handoff owner. One line; kills a double-speak on *every*
   reply in the shipped default config.
2. **VN-2** — the gist fallback on the native driver; removes "answered by silence".
3. **VN-3 / VN-4** — one root shape: the room is handed back while the turn is alive. Label the late
   wake reply; serialize the call speaker.
4. **C-2 / VN-6** — stop promising auto-continuation on a thread that never continues, and let a
   voice survivor be dropped.
5. **VN-5** — decide the call-leg trust boundary deliberately (the code already picked one).
6. **VN-7 / VN-8** — the two spoken-notice gaps.
7. **Observability**: a failed *overlay* voice turn is deliberately silent and shows text on screen
   (`voice-command-session.ts:109-111`) — which a hands-free user is not looking at. Product call.

### The three open forks

- **`direct_to_user` answers reaching voice — do not open it; close it through the `speak` door.**
  `compose-global-root-provider-message.ts:56-61` skips the catch-up collector on voice for a sound
  reason (the collector is a user-wide, exactly-once, one-way latch — a voice turn absorbing it
  would *steal* the reports from the global chat). Making voice a second consumer needs per-consumer
  surfacing state, i.e. a schema change, for a small win. Let the delivery turn call `speak` when the
  user's last interaction was spoken, and leave the ledger where it is.
- **Voice-fired tasks parenting on the global conversation — keep, and mark it locked.** The code
  states the model plainly: *"the voice thread fires work but never holds the ledger"*
  (`compose-global-root-provider-message.ts:56-59`). Re-parenting would put a report ledger behind a
  surface with no reading affordance and fork the collector.
- **Per-call routing toolset — build it, and make the desktop exclusion its first slice.** Today a
  call session gets the plain session descriptor **plus the full desktop server** and no routing —
  the worst combination (it can drive the machine but cannot route work). V1 and W1 are closed, so
  the round-1 prerequisite is satisfied; scoping the toolset deliberately also fixes VN-5.

---
