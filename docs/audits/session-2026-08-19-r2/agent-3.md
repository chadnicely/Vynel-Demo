# Session-system audit — round 2, agent 3 (delegation-engine entry)

Worktree `E:/KLONE/Workspace/vynel/.claude/worktrees/session-audit` @ `71dbe151` (main, the
session-hardening merge). Read-only; two throwaway vitests were run and deleted (`git status` clean).
Entry point per the brief: the delegation engine, then widened to streams, continuity, voice, and the
web monitoring layer.

**Legend.** `CONFIRMED` = traced hop-by-hop in this checkout, or reproduced by a throwaway vitest I
ran. `PLAUSIBLE` = strongly implied by the code but not executed. Round-1 ids are the README's
(`L1`, `V1`…); new ids are `R2-*`.

---

## Headline

The arc did what it said. Every round-1 P1 is closed in code, most of them with a real regression
test at the seam (the lock-lifetime invariant, the call-leg tier, the catch-up seam, the continuity
census, the wait-gate suspension). The delegation engine in particular is now genuinely
single-writer end-to-end and I could not break it by reading.

**But the arc changed two CROSS-CUTTING FIELDS and audited only the consumers inside its own slice
map, and that produced two P1 regressions that every green test missed:**

- **`primarySessionId`** — stamping it on every global/voice turn (the correct fix for V2) made the
  working rail's first branch always win, so the user's own Global turn now rails as a nameless
  "Working…" chip, a Telegram turn loses its "Claude" chip, and a voice turn's chip opens a session
  the server walls off. The consumer sits inside slice D's own ownership list, and its test pins the
  pre-arc frame — which is why every gate stayed green. **R2-13.** This one is the clean proof of the
  pattern.
- **`permissionMode`** — `DEFAULT_SESSION_MODE = 'auto'` did not only change what cards. It also
  changed **which turns count as "auto"** for the DESKTOP plan-consent policy, and that policy's
  ruling (Kafi 2026-08-11: "in auto/bypass, no card at all — those modes ARE the standing consent")
  was written when `auto` meant *the user picked auto*, not *nobody picked anything*. The population
  that newly carries standing desktop consent is exactly the turns with no human pick anywhere in
  the chain. **R2-1** — higher stakes, and the reason I'd fix it before the smokes.

Both are small, local fixes. Both would have been caught by a consumer census per changed field, and
neither shows up in `pnpm test`.

---

## 1. Bugs — all scopes

### P1

**R2-1 · P1 · global · workspace · spawned · channels · delivery · voice — `DEFAULT_SESSION_MODE = 'auto'`
silently widened the population that carries DESKTOP `standing-consent`: every turn where NOBODY EVER
PICKED a mode now authorizes desktop acting uncarded. CONFIRMED (traced hop-by-hop + git-diffed
against `06781328`).**

**Read the scope carefully — this is not "a locked decision was violated".** Kafi's 2026-08-11 ruling
is deliberate and correct on its own terms, and the code states it well
(`apps/local-api/src/sessions/build-workspace-background-mcp.ts:255-263`):

```
// Kafi settled the fork (2026-08-11): **in auto/bypass, no card at all** —
// those modes ARE the standing consent, and that carries into work the user
// delegated during the turn. … One-time authority was the original intent.
```

That ruling was written when `auto` meant **the user picked auto**. D3 made `auto` also mean **nobody
picked anything**, so the ruling's premise moved without the ruling being revisited. The finding is
the *population change*, not the policy.

Where:
- `packages/session/src/session-mode.ts:82` — `export const DEFAULT_SESSION_MODE: SessionMode = 'auto'`
- `packages/desktop-control/src/plan/desktop-plan-consent.ts:12-25`

```ts
export function deriveDesktopPlanConsent(permissionMode: string | undefined): DesktopPlanConsent {
  switch (permissionMode) {
    case 'ask':    return 'approval-card'
    case 'auto':
    case 'bypass': return 'standing-consent'
    default:       return 'display-only'
  }
}
```

Two comments carry the now-stale premise. `desktop-plan-consent.ts:5-8`:

```
// ruling for — anything else (absent mode = the unattended
// `bypass-with-behavior-gate` default, or a future mode this policy hasn't
// ruled on) falls to 'display-only', the conservative floor: … preserving
// "a background turn can never self-grant" (Chad 2026-08-04).
```

and `build-workspace-background-mcp.ts:265-270`:

```
// Everything else still falls to `display-only`: a channel-origin or
// pre-mode job carries no mode, the runner defaults it to
// `bypass-with-behavior-gate`, and there the floor HOLDS … "A background turn
// can never self-grant" survives exactly where it was meant to.
```

Both `default:` / "everything else" branches are now **unreachable from any Vynel-driven turn** —
§2 of the arc note says so out loud ("`bypass-with-behavior-gate` stops being a fallback anywhere").
So the sentence "survives exactly where it was meant to" is the part that stopped being true.

Hop-by-hop, the delegated path:
1. `packages/session/src/delegation/run-task-job.ts:207-214` → `resolveBackgroundTurnSettings`.
2. `packages/session/src/delegation/resolve-background-turn-settings.ts:69-73` —
   `input.job.permissionMode ?? row mode ?? toPermissionMode(DEFAULT_SESSION_MODE)` → `'auto'`.
3. `run-task-job.ts:275` — `permissionMode: turnSettings.permissionMode` is now passed
   **unconditionally** into the MCP composer.
4. `apps/local-api/src/sessions/build-workspace-background-mcp.ts:291` —
   `desktopPlanConsent: deriveDesktopPlanConsent(permissionMode)` → `'standing-consent'`.
5. `packages/desktop-control/src/plan/desktop-plan-envelope.ts:168` —
   `if (plan === null || consent === 'display-only') return false` — i.e. under `display-only`
   **every plan-gated act refuses**; under `standing-consent` it authorizes.

Pre-arc (`git show 06781328:.../run-delegation-claim-and-run-tick.ts:485-486,499`) the composer got
`...(claimed.permissionMode !== null ? { permissionMode: claimed.permissionMode } : {})` — a job row
with a NULL mode passed **nothing**, so `deriveDesktopPlanConsent(undefined)` → `'display-only'`.

Same flip on the other unattended surfaces:
- channel (Telegram) turns: `apps/local-api/src/sessions/run-global-root-turn.ts:267` (`?? DEFAULT_SESSION_MODE`) → `:364`;
- a brand-new global thread with no mode ever picked: `apps/local-api/src/streams/interactive-turn-settings.ts:71` → `apps/local-api/src/streams/global-root-turn.ts:292`;
- delivery / update / direct / note notify turns (same resolver as (2));
- a fresh spawned session (born NULL settings on the call leg / any non-ambient create).

Failure scenario: Kafi enables the desktop feature, walks away, and a Telegram message (or a
scheduled fire, or a report delivery, or a spawned session created with no ambient turn) proposes a
desktop plan. Before the arc that plan narrated on the overlay and every act refused. Now the plan
carries standing consent and the turn clicks, types and sets volume on the machine with **no card and
no human in the loop** — and nothing in the arc's §1/§2/§7 records that consequence.

**"Attended vs unattended" is NOT the axis to fix on** — I checked the other side:
`apps/local-api/src/streams/session-turn.ts:210` passes `deriveDesktopPlanConsent(turnPermissionMode)`
for a spawned-session DM, so a human typing into a session born with NULL settings also resolves
`auto` → `standing-consent`. The axis that actually separates the two populations is **did anyone
ever pick this mode**, and that fact still exists at the resolver:
`packages/chat/src/settings/resolve-turn-session-settings.ts:47` returns
`mode: input.mode ?? row?.sessionMode ?? undefined` — `undefined` means "never set". Both callers
then throw it away by collapsing to the default
(`interactive-turn-settings.ts:71`, `resolve-background-turn-settings.ts:69-73`).

Minimal fix (no re-litigation of D3, no behaviour change to what CARDS): keep `permissionMode` as the
provider's mode, and hand the desktop policy the *provenance* alongside it — e.g. carry
`modeWasChosen: resolved.mode !== undefined` through the two resolvers and make
`deriveDesktopPlanConsent(mode, { chosen })` return `standing-consent` only when `chosen`,
`display-only` otherwise. That restores Kafi's 08-11 ruling to exactly the population he ruled on,
and makes the two stale comments true again. If Kafi instead wants the wider population, the fix is
to say so in `desktop-plan-consent.ts` and delete the dead `default:` branch — but that should be a
decision, not a side effect.

---

**R2-2 · P1 · voice — a checkpoint that survives a restart on the VOICE thread is never continued and
never dropped: it lives on `primary_sessions` forever and the user is never told. CONFIRMED
(reproduced by a throwaway vitest, run + deleted).**

Where: `packages/session/src/runtime/run-turn-with-continuations.ts:91-97` and
`apps/local-api/src/streams/global-root-turn.ts:444-446`.

```ts
const drop = (checkpoint: PendingCheckpoint, reason: DropPendingCheckpointReason): void => {
  if (input.autoContinue === false && checkpoint.checkpointedAt < startedAt) return
  dropPendingCheckpoint(db, primarySessionId, { reason, ... })
}
```

The `autoContinue === false` early-return is correct for a *delivery* turn (the survivor belongs to
the identity's next real turn, which is an interactive turn that will pick it up). The voice thread is
the one identity where **every** turn is `autoContinue: false`:

```ts
...(isVoiceTurn ? { voice: true, originChannel: 'voice' as const, autoContinue: false } : {}),
```

and the `checkpoint` tool IS attached to voice turns
(`packages/session/src/mcp/session-mcp-feature-descriptor.ts:63` — `toolNames: [WHOAMI_TOOL_NAME, CHECKPOINT_TOOL_NAME]`,
composed at `global-root-turn.ts:199` for both legs). So a voice turn that calls `checkpoint` and
dies before the loop can act (process restart, `session-errored`) leaves a survivor that:
- is never continued (`autoContinue: false` breaks the loop at `:104-107`),
- is never dropped (the guard above returns early on every subsequent turn),
- writes no "Not continued — the next step was: …" note.

Repro (`packages/session/src/runtime/audit-r2-agent-3-voice-survivor.test.ts`, run green, deleted):
seed a `scope: 'voice'` primary, `markPendingCheckpoint(...)` dated before the turn, run three
`autoContinue: false` turns → `peekPendingCheckpoint` still returns the same `nextStep` and zero
`Not continued` rows exist on the head.

Live effect: `beginGenuineTurn` logs "a pending checkpoint survived from before this turn — it
continues after it" on **every** subsequent voice turn (a permanently false log line), the row's
depth counter resets each turn, and the exact silence the whole `dropPendingCheckpoint` mechanism was
built to end ("Vynel stopped mid-task and said nothing", `drop-pending-checkpoint.ts:5-9`) is
reproduced on the one surface where the user cannot see a transcript note anyway.

Minimal fix: the survivor rule should key on "does this identity ever run automatic continuations",
not on this turn's flag. Simplest honest version — in `runTurnWithContinuations`, when
`autoContinue === false` **and** the caller declares the identity never continues (a new
`neverContinues?: boolean`, set by the voice leg), drop the survivor too; or have the voice leg drop
its own survivor before the turn.

---

**R2-13 · P1 · global · voice · channels · monitoring — the arc's own `primarySessionId` stamp broke the
working rail: the user's OWN global turn now rails as a nameless "Working…" chip, and a voice turn
rails a chip that opens a 404. CONFIRMED (traced producer → consumer → render → click). REGRESSION
INTRODUCED BY THE ARC.**

`apps/local-web/src/composables/activity/use-working-rail.ts:127-150` branches in this order:

```ts
for (const turn of serverTurns) {
  if (turn.primarySessionId != null) {
    upsert({ kind: 'session', key: `session:${turn.primarySessionId}`, label: turn.personaName ?? '',
             segmentId: turn.sessionId ?? null, ... })
  } else if (turn.scopeKind === 'workspace' && turn.workspaceId != null) { ... }
  else if (turn.origin !== 'web') { upsert({ kind: 'brain', key: 'brain', label: 'Claude', ... }) }
```

Before the arc a global turn carried no `primarySessionId`, so the third branch decided: a channel
turn railed as "Claude" and the user's own web turn railed as **nothing** (the rail's stated rule —
"the user's OWN web turn is the thread they're looking at, never rails",
`use-working-rail.test.ts:53`). C3/D1 now stamp it on **every** global and voice turn
(`apps/local-api/src/streams/global-root-turn.ts:334-339`;
`apps/local-api/src/sessions/run-global-root-turn.ts:406-410`), so the FIRST branch always wins and
the third is unreachable for the global family.

Rendered consequence — `apps/local-web/src/components/rail/WorkingRail.vue:33`:

```ts
return entity.label === "" ? "Working…" : entity.label;
```

`personaName` is never stamped on an interactive global/voice turn, so the chip's label is `""` →
**"Working…"**. Three concrete failures:
1. The user types in the Global chat → a "Working…" chip appears for the very thread they are
   watching (the case the rail was built to exclude).
2. A Telegram reply rails as "Working…" instead of "Claude" — the `brain` chip is now dead code.
3. A **voice** turn rails a session chip whose `segmentId` is a voice segment;
   `WorkingRail.vue:57-58` calls `sidebar.openSession({ sessionId: entity.segmentId })`, and the
   sessions detail route walls voice off for a non-global-root caller
   (`apps/local-api/src/routes/sessions/index.ts:276-278` —
   `forbiddenScopes: fromGlobalRoot ? [] : ['global', 'voice']`). So the click yields a 404'd sidebar
   pane. **Not a data leak — a dead pane** — but it is the voice wall being *hit* from a surface that
   should never have offered the door.

Why it stayed green: `use-working-rail.test.ts:50-54` feeds the **pre-arc** wire shape
(`{ scopeKind: 'global', origin: 'telegram' }` / `{ scopeKind: 'global', origin: 'web' }`, no
`primarySessionId`) and asserts `['brain','brain',true]` at `:63`. The test pins a frame the server
no longer emits — the same failure mode as R2-1 and R2-6: a consumer of `primarySessionId` /
`permissionMode` that was outside the slice's mental model.

`use-working-rail.ts` **was** in slice D's ownership (`composables/{sessions,activity}/**`); D fixed
`matchTurnToIdentity` and missed this one. Minimal fix: reorder — test `scopeKind === 'global' | 'voice'`
before the `primarySessionId` branch (a global-area turn is never a "session" chip), and update the
fixture to the post-arc frame.

### P2

**R2-3 · P2 · global · workspace · delivery — a CHANNEL-driven global turn is the one lock holder with
no wall clock and no hard cap. CONFIRMED (traced).**

`apps/local-api/src/services/channels-service.ts:90` calls `runGlobalRootTurn(...)` directly (not
through `routeRequest`), and `apps/local-api/src/sessions/run-global-root-turn.ts` contains **no**
`startTurnWallClock` / `startPausableTimeout` (grep: the only bound in the file is
`CHANNEL_ASK_TIMEOUT_MS = 10 * 60 * 1000` at `:61`, which bounds an `ask_user`, not the turn). The
whole turn runs under `runUnderRootTurnLock(${userId})`
(`packages/session/src/runtime/run-global-root-turn-core.ts:95-96`).

So the acceptance bar "every approval/ask/lock/turn has a bound and an owner" (§4) holds for the
three interactive streams (C4) and every delegated runner (A1), and is **not** met for the channel
runner. A hung provider await on a Telegram turn still wedges `${userId}` for the process lifetime.

Mitigation the arc did add and it is real: a global delivery queued behind that lock now YIELDS its
pool slot instead of burning its budget (`run-report-delivery-tick.ts:279-291`), so the G1 cascade
("deliveries burn their 600 s and settle failed") is broken. The wedge itself is not.

Minimal fix: the channel runner already receives an optional `waitGate`; give it the same
`startTurnWallClock` + `failTurnOnWallClock` the three streams share (both are exported from
`@vynel/session/runtime`), bounded by `VYNEL_INTERACTIVE_TURN_MAX_MS` or its own knob.

---

**R2-4 · P2 · all delegated — `SessionTargetLocks.acquire()` is still unbounded and uncancellable; a
user's continue-turn can park for the full 60-minute hard cap behind a delegated run, and a client
disconnect does not cancel the park. CONFIRMED (traced).**

`packages/session/src/delegation/session-target-locks.ts:28-35` — `acquire` returns a bare promise
parked on a FIFO array; there is no timeout and no abort. Callers:
`apps/local-api/src/streams/chat-turn.ts:550` (`await locks.acquire(workspaceId)`) and
`apps/local-api/src/streams/session-turn.ts:281`.

Round-1 recorded this as S1/#7 with "recovery: holder releases". After A1 the holder's ceiling went
UP (the tick now settles only when the turn does), so the *worst-case* park a user can experience got
longer, not shorter: `VYNEL_DELEGATED_TURN_MAX_MS` defaults to 3 600 000 ms
(`apps/local-api/src/env.ts:72`). The user sees only a `turn-queued { reason: 'busy' }` sentinel
(`chat-turn.ts:540-549`) and then silence for up to an hour.

Worse in the disconnect case: `streamSSE`'s callback keeps running after the client goes away, so the
acquire eventually resolves and a **full provider turn runs against a dead stream** — the lock is
correctly released in the `finally` (`chat-turn.ts:558`), so this is cost + a phantom turn, not a leak.

Minimal fix: `acquire(key, { signal })` (drop the waiter on abort) plus the request's abort signal at
both call sites; and/or a bounded acquire that answers the composer with an honest
"still busy — try again" frame rather than parking indefinitely.

---

**R2-5 · P2 · delegation — the terminal CAS is on STATUS, not on the CLAIM's identity: a dead run's
late `requeueDelegationJob` can re-stamp a row the sweeper already handed back, bumping
`attemptCount` and delaying the message the sweeper deliberately refused to penalise. CONFIRMED
(read; the double-execution half is correctly blocked by the in-process target lock).**

`packages/orchestration/src/repositories/delegation-jobs.ts:349-375`:

```ts
.where(and(eq(delegationJobs.id, id), inArray(delegationJobs.status, ['claimed', 'pending'])))
```

The `'pending'` disjunct is documented as "a row the lease sweeper already handed back is pending;
re-stamping its deadline is harmless". It is not entirely harmless: the sweeper's own contract
(`packages/orchestration/src/repositories/delegation-jobs-recovery.ts:22-26`) says

```
// orphaning is the process's failure, not the delivery's, and a bounded
// counter here would eventually destroy a message on a crash-looping machine —
// the one outcome this exists to prevent.
```

but `requeueForAnotherAttempt` (`classify-turn-failure.ts:58-66`) writes
`attemptCount = (job.attemptCount ?? 0) + 1` and a 30 s/5 min backoff onto exactly that row. Three
such collisions and a report / note / direct answer hits `DELEGATION_MAX_ATTEMPTS` and is destroyed —
the outcome the sweeper's design refuses.

Reachability today is narrow (the lease is 3 min with a 30 s heartbeat, and `env.ts:187-192` refuses a
heartbeat that cannot renew inside the lease), so P2, not P1. The clean shape is a claim token: stamp
`claimedAt` (or a per-claim uuid) at claim time and add it to every terminal `WHERE`, so a write is
accepted only from the run that owns the claim.

---

**R2-6 · P2 · all — with `auto` the default, the per-turn "mutating tools always card" floor is dead
on every default session; `alwaysRequireApprovalToolNames` is now inert unless a user explicitly
picked Ask. CONFIRMED (traced).**

`packages/providers/src/claude/approvals/tool-approval-policy.ts:103-113`:

```ts
export function decideCanUseTool(toolName, mode, sets): CanUseToolDecision {
  if (approvalFloorStandsDown(mode)) return 'allow'   // auto | bypass
  if (mode === 'bypass-with-behavior-gate') return isAlwaysCardTool(toolName, sets) ? 'card' : 'allow'
  ...
```

`approvalFloorStandsDown` (`:56-58`) is checked **before** `isAlwaysCardTool`, and
`requiresApprovalCardBackstop` (`:84-93`) does the same. Every composer still computes and passes
`mutatingToolNames` (`global-root-turn.ts:210`, `session-turn.ts:250-253`, `chat-turn.ts`), so the
plumbing is intact and the effect is zero.

This is a *consequence* of locked D3, not a violation of it — but it is worth stating plainly because
the CLAUDE.md rule "Mutating tools declare `mutatingToolNames` (they auto-card)" and the
`vynel-approval-tier-model` memory note both still describe a floor that no longer fires by default.
Pair it with R2-1: the two together mean a default Vynel install has **no Vynel-side human gate on
any tool, including desktop actuation.**

---

**R2-7 · P2 · continuity — a new checkpoint SILENTLY overwrites a restart survivor; the promised
"continues after this turn" is broken with no note. CONFIRMED (reproduced by throwaway vitest).**

`packages/session/src/continuity/pending-checkpoints.ts:74-87` — `markPendingCheckpoint` overwrites
the slot unconditionally ("the latest intent wins", `:22-24`). But
`run-turn-with-continuations.ts:80-86` has just PROMISED the survivor a continuation:

```ts
const survivor = beginGenuineTurn(db, primarySessionId)
if (survivor !== null) input.logger?.info({...}, 'a pending checkpoint survived from before this turn — it continues after it')
```

If the genuine turn itself checkpoints, the survivor's `nextStep` is gone — no continuation, no
`dropPendingCheckpoint` note, only the (now false) info line. Reproduced: seed survivor "STEP A", run
a genuine turn that calls `markPendingCheckpoint(..., 'STEP B')` mid-turn → no message body contains
"STEP A".

Minimal fix: `markPendingCheckpoint` drops a note when it displaces a *different* pending step (it
already has `dropPendingCheckpoint` next door), or the loop snapshots the survivor and re-queues it.

---

**R2-14 · P2 · nodes — project-level message arcs can never land on a spawned-session dot: the server
emits a PRIMARY-session id where the client maps CHAT-SESSION (segment) ids. CONFIRMED (both halves
read; the id spaces are provably distinct).**

Producer — `packages/orchestration/src/queries/list-recent-message-edges.ts:76`:

```ts
toSessionId: job.targetPrimarySessionId,
```

Consumer — `apps/local-web/src/composables/nodes/use-project-nodes.ts:157-160` builds
`nodeIdBySegmentId` from `entry.segments[].sessionId` (chat-session ids), and
`message-scene-mapping.ts` resolves `toSessionId` through that map. The contract the ref file states
is the opposite (`apps/local-web/src/utils/constellation-node-ref.ts:32-37`):

```
 *  the CHAT-SESSION id … Never a primary-session id: a ref that cannot open a
 *  door is not an identity.
```

And the two spaces are separate fields on the same entry
(`packages/session/src/overview/compose-overview-entry.ts:127-128` returns `sessionId: tail.id`
**and** `primarySessionId` distinctly). Note the asymmetry that makes this a bug rather than a
choice: `fromSessionId: job.parentSessionId` IS an SDK/chat-session id, so the `from` end of every
arc resolves and the `to` end does not.

Failure scenario: the build hands work to a spawned session inside a project. The unresolved `to`
falls back to the scene's core (`utils/constellation-scene.ts:392-396`), so every ask arc inside a
project points at the middle of the screen instead of the session it addressed — on the screen whose
whole job is "show what just happened". Minimal fix: resolve `targetPrimarySessionId` → its head
segment id in the query (it already has `db`), or add `toPrimarySessionId` beside it and let the web
map both.

### P3 / latent

- **R2-15 · P3 · nodes — the project level paints a confident status before the status polls answer.**
  `apps/local-web/src/composables/nodes/use-project-nodes.ts:137-141` computes `hasAnswered` from the
  sessions + continuing queries only, omitting `workspaceStatuses.hasAnsweredStatuses`, while the
  build dot's colour comes from `statusByWorkspaceId[...] ?? "not_running"` (`:103-108`). The FLEET
  level guards exactly this (`use-fleet-nodes.ts:77-84`) — F1 fixed one half of round-1's N2 and left
  the other. A project whose room last failed shows a grey dot and "1 idle" for the poll's flight.
- **R2-16 · P3 · monitoring — `TasksPanel`'s live card first-matches over the global FAMILY.**
  `apps/local-web/src/components/tasks/TasksPanel.vue:103-116` filters `{ kind: 'global' }` (which by
  design holds the root's turn AND every delegated run) then takes `workingTurns.value[0]?.sessionId`.
  Same class the store fixed for `globalServerTurnOrigin` by sorting oldest-first
  (`stores/activity-store.ts:44-47`); this consumer did not get the fix.
- **R2-17 · P3 · monitoring — a voice turn turns the Global Tasks panel "running" and makes the typed
  global thread poll.** `composables/sessions/use-workspace-status.ts:129` folds
  `activity.hasGlobalServerTurn` (= global ∪ voice, `composables/activity/match-turn-to-identity.ts:59-64`)
  into the plain `globalStatus`, which `TasksPanel.vue:70-73` consumes *because*
  `components/shell/AppShell.vue:310-311` says that one should exclude voice. Same root:
  `views/GlobalChatView.vue:212-222` drives a 4 s transcript refetch for the whole of a spoken turn.
- **R2-18 · P3 · monitoring — the workspace-identity invariant has no server-side test (latent P1).**
  `match-turn-to-identity.ts:45-49` requires `primarySessionId === null` to bind a room; the producer
  satisfies it only by OMISSION (`apps/local-api/src/streams/chat-turn.ts:431-437` — no
  `primarySessionId` key), and no test in `apps/local-api/src/streams/chat-turn.test.ts` observes the
  feed at all (`SessionActivityFeed` appears only in `global-root-turn.test.ts`). The natural next
  "stamp identity everywhere" pass — the exact symmetry the arc just applied to the global leg —
  breaks every workspace room's live binding at once with every test still green. §6 records it as a
  doc-ask; it wants a test.
- **R2-8 · P3 · delivery — `recordDirectReplyMessage` is the one system-authored inbound writer NOT
  keyed by the delivery job id.** `packages/chat/src/records/record-direct-reply-message.ts:42` uses
  `id: randomUUID()` and `insertChatMessage`, while every other inbound write went find-or-insert in
  A3c (`consume-session-event-stream.ts:157`, `handle-session-started.ts:164,209`). `'direct-delivery'`
  IS in `ORPHAN_REQUEUE_JOB_KINDS` (`delegation-jobs-recovery.ts:29`), so a requeued direct delivery
  would land the same final answer twice. **Unreachable today** — the persist+complete co-commit at
  `run-report-delivery-tick.ts:240-250` is inside one synchronous block from the claim, so no
  `claimed`-with-row-persisted state can exist. It becomes reachable the moment an `await` appears
  before that transaction, or in Phase 2. One-line hardening: `id: claimed.id` +
  `insertChatMessageIfAbsent`.
- **R2-9 · P3 · delegation — sub-millisecond cap/settle race can report a COMPLETED task as `capped`.**
  `packages/orchestration/src/routing/route-request.ts:105-120,147-156`: the cap handler sets
  `capFired = true` *before* awaiting `onHardCap`, and `settled` is only set after the delegate's
  promise chain resolves. If the timer's microtask wins by a hair at exactly the cap boundary, a turn
  that completed normally settles through the give-up push with its report suppressed. Fix: re-check
  `settled` after the `await deps.onHardCap?.()`, or gate the `capped` envelope on
  `capFired && outcome.status !== 'completed'`.
- **R2-10 · P3 · delegation — the direct-reply branch trusts `persisted` even when the co-committed
  `completeDelegationJob` CAS lost.** `run-report-delivery-tick.ts:240-250`: `persisted` is set inside
  the tx and `completeDelegationJob(...)`'s null return is discarded, so `:252-269` logs "delivered
  DIRECTLY" and returns true on a row someone else settled.
- **R2-11 · P3 — no index backs the two new scans.** `packages/db/src/migrations-sqlite/0050_session_hardening_durable_state.sql`
  adds `delegation_jobs.lease_expires_at` with no index (60 s sweeper scan) and F's
  `listDelegationJobsForParentSessions` (`delegation-jobs.ts:618-637`) has none on `parentSessionId`
  (already recorded in §6 as a note for A; still open).
- **R2-12 · P3 — the denominator still tracks a visitor's model on rows with no chosen model.**
  `packages/chat/src/turn-consumption/handle-usage-reported.ts:74-75` —
  `selectedModel ?? event.model ?? sessionModel`. On channel-born / voice / delegated-only identities
  `selectedModel` is NULL by construction, so a small-model delegated visitor still lowers
  `lastContextWindow`. The header says so honestly; recording it because round-1 listed it as a
  continuity break and it is only two-thirds closed.

---

## 2. Stuck points

| # | Stuck point | How | Bound / recovery today | Verdict |
|---|---|---|---|---|
| 1 | Delegated run holds its target key | the tick now settles only when the turn does (A1) | `VYNEL_DELEGATED_TURN_MAX_MS` 60 min → `onHardCap` → `cancelLever.interrupt` → the coordinator awaits the settle (`route-request.ts:105-156`, `delegated-turn-cancel-lever.ts:46-55`) | **closed**, with a regression test (`run-delegation-claim-and-run-tick.hard-cap.test.ts:151`) |
| 2 | Delegated turn parked on an approval card | the cap clock SUSPENDS while parked (`pausable-timeout.ts:41`), so the cap can never cut a parked turn | the approvals reaper at `requestedAt + 2×5 min` (`recover-stale-pending-approvals.ts:68`), which calls `provider.respondToApprovalRequest` FIRST (`:82-98`) → the `canUseTool` promise resolves → `build-claude-can-use-tool-callback.ts:92-100` emits `approval-resolved` → `build-routed-approval-handler.ts:100-102` un-parks the gate → the cap clock re-arms | **closed** — I chased the full loop because a gate that never un-parks would make the hard cap unreachable. It un-parks. |
| 3 | Claimed job whose run is gone | boot pass + 60 s lease sweeper, settled BY KIND (`delegation-service.ts:129-139` → `delegation-orphan-settlement.ts`) | messages requeue, work rows fail + one honest failure delivery | **closed** |
| 4 | Global delivery queued on a busy root lock | it now yields its pool slot, pending, due in 5 s, no attempt spent (`run-report-delivery-tick.ts:279-291`) | — | **closed** (G1's delivery half) |
| 5 | Interactive turn wedged on a provider await | `startTurnWallClock` on all three streams (`global-root-turn.ts:371-396`, `chat-turn.ts:402-424`, `session-turn.ts:417-421`), armed inside the lock, suspended while parked, expiry = failure row + interrupt | `VYNEL_INTERACTIVE_TURN_MAX_MS` 60 min | **closed** |
| 6 | **Channel-driven global turn wedged** | no wall clock, no cap | none | **R2-3, OPEN** |
| 7 | **User continue-turn parked behind a delegated run** | `locks.acquire` unbounded + uncancellable | holder releases (now up to 60 min) | **R2-4, OPEN** (worse than round 1) |
| 8 | Interactive `ask_user` never answered | `timeoutMs = VYNEL_INTERACTIVE_ASK_MAX_MS` (2 h) on the tool's own timer (`ask-user-tool.ts:71-90`) + a 60 s orphan reaper (`asks-recovery-service.ts:37-53`) + the turn's `finally` cancel | | **closed** |
| 9 | Voice turn wedged, daemon deaf | `armTurnWatchdog` (5 min default, `turn-watchdog.ts:25-54`) → "still working", room handed back, SSE read aborted; `streamTurnEvents` also has a 10 s connect deadline (`run-brain-turn.ts:68,92-96`) | | **closed** |
| 10 | Voice thread parked on `ask_user` | the descriptor is not attached on a voice turn (`global-root-turn.ts:217-227`) | | **closed** |
| 11 | Voice checkpoint survivor | — | none, ever | **R2-2, OPEN** |
| 12 | Delegated turn parked on `ask_user` | `buildAskFeatureDescriptor` has exactly four call sites, all interactive/channel (grep) — routed turns never get the tool | | **closed by construction** |

Nothing I could find leaks a target key, a pool slot or a cancel-registry entry: `runTaskJob`'s outer
`finally` (`:411-414`) ends the cancel handle and the feed handle on every path, the pool's `.finally`
(`delegation-service.ts:188-209`) decrements and releases on every launch (claimed or not), and
`startDelegationLeaseHeartbeat` is stopped in the tick's `finally` (`run-delegation-claim-and-run-tick.ts:165-167`).

---

## 3. Modes / models / effort / autoBuildout — binding and inheritance

Rule everywhere: **`input (tool arg / job) ?? target row ?? DEFAULT_SESSION_MODE('auto')`**, in two
homes only — `apps/local-api/src/streams/interactive-turn-settings.ts` (attended) and
`packages/session/src/delegation/resolve-background-turn-settings.ts` (unattended).

| Path | mode | model | effort | autoBuildout | Source of truth | Verified by |
|---|---|---|---|---|---|---|
| Global web | input ?? row ?? **auto** | input ?? row (no fit — attended) | input ?? row | input ?? row → marker | `interactive-turn-settings.ts:68-75`; `global-root-turn.ts:437-440` | read |
| Voice — wake / overlay / typed panel | **forced `auto`** | **forced tier + fit clamp** | **forced `low`** | **always undefined** | `interactive-turn-settings.ts:78-103`; `contracts/chat/voice-tier.ts:32-41` | read; row never read/written (`global-root-turn.ts:357-359`) |
| **Voice CALL leg** | forced `auto` (`voice: true` on `/sessions/:id/turn`) | forced tier + fit clamp | forced `low` | undefined | `session-turn.ts:106-112`; daemon sends it too (`call-session-client.ts:43-49`) | **V1 closed** |
| Workspace chat | input ?? row ?? auto | input ?? row | input ?? row | input ?? row → marker | `chat-turn.ts:132-137, 331-333` | read |
| Spawned / agent DM | same | same | same | same | `session-turn.ts:48-53, 347-350` | read |
| Spawned session BIRTH | creator row's four columns | ✓ | ✓ | ✓ | `routes/sessions/index.ts:83-106, 334-345` (`readCreatorSessionSettings` off the ambient turn header) | **T2 closed for spawned** |
| Leaf session BIRTH | **still NULL** | NULL | NULL | NULL | `packages/chat/src/records/record-leaf-session.ts:49-66` | **deliberately deferred (§7)** — behaviourally covered by the resolver |
| Delegation enqueue → job row | `x-vynel-delegation-mode`, stamped **unconditionally** now | tool arg else NULL | tool arg | — | `chat-turn.ts:189`, `session-turn.ts:64-66`, `global-root-turn.ts:183` | **T1 closed** |
| delegate-to-{workspace,spawned,agent} | job ?? target row ?? auto | job ?? `agent.model` ?? row, **fit-checked** | job ?? row | target row | `resolve-background-turn-settings.ts:57-101`; `run-task-job.ts:207-214` | **M1 closed** |
| Agent-run job | same | same (`fallbackModel: agent.model`, `run-agent-run-job.ts:208-212`) | job ?? row (`enqueueAgentRun` now has the field) | target row | | **T3 closed** |
| Checkpoint follow-up job | copied | copied | **copied** (`enqueue-checkpoint-continuation.ts:159-161`) | — | one `shared` spread | closed; `origin` on agent-run still deferred (§7) |
| Report / update / direct / note delivery | requester row ?? auto | requester row | requester row | requester row | `run-report-delivery-tick.ts:397-405` | closed (was hardcoded NULL) |
| Channels (global row) | row ?? auto | row + fit | row | row (`run-global-root-turn.ts:283`) | `run-global-root-turn.ts:267-283` | **D1 as locked** |
| Swap segment | copy-forward (4 cols + status trio) | ✓ | ✓ | ✓ | pinned by test per §6 | closed |

**Gaps that remain:**
1. **R2-1** — the mode is now also a *desktop-authority* token, and the two defaults disagree about
   what "unattended" means.
2. **R2-6** — `mutatingToolNames` is inert on every default session.
3. Leaf rows still born NULL (`record-leaf-session.ts:49-66`) — row hygiene only, per §6 ask 5 and §7.
4. `EnqueueAgentRunInput.origin` — deferred, no live caller (§7); verified there is genuinely no field
   (`enqueue-checkpoint-continuation.ts:178-180` says so explicitly).
5. A **voice** row can never hold settings and `updateChatSessionSettings` 403s it
   (`packages/chat/src/settings/update-chat-session-settings.ts:44-47`) — verified, B5 closed.

---

## 4. Missed improvements

0. **A consumer census per changed field.** This is the one process change that would have caught
   R2-1, R2-6 and R2-13 before the merge, and it costs one grep per field. `permissionMode` is read
   by `tool-approval-policy.ts`, `delegation-mode-header.ts` and `desktop-plan-consent.ts`;
   `primarySessionId` is read by `match-turn-to-identity.ts`, `use-session-statuses.ts`,
   `desktop-activity-fold.ts` and `use-working-rail.ts`. The slice map covered two of three and three
   of four. Where a test exists for a wire-shape consumer, it must be rebuilt from the *current*
   producer, not hand-written — `use-working-rail.test.ts:50-54` is the counter-example.
1. **The claim needs an identity, not a status** (R2-5). Every terminal writer is a CAS on
   `status = 'claimed'`, which cannot tell "my claim" from "the successor's claim". A `claimToken`
   column stamped at claim time and matched in every `WHERE` is ~10 lines and makes the whole
   lease/sweeper story provably safe — including the Phase-2 semantics §7 defers.
2. **One bound is missing from the "every wait has an owner" sweep**: the channel runner (R2-3). The
   arc built `turn-wall-clock.ts` as ONE home for exactly this and then wired three of four callers.
3. **`SessionTargetLocks` has no abort** (R2-4). Everything else in the arc learned to take a signal;
   this one did not, and it is the wait a *user* experiences.
4. **`ApprovalWaitGate.onParkedChange` accepts a single subscriber** (`approval-wait-gate.ts:34-36`) —
   `this.listener = listener`, last writer wins. Today exactly one `startPausableTimeout` subscribes
   per gate and I verified no site double-subscribes, but the class is a silent trap for the next
   consumer (a second clock would disable the first). Make it an array, or name the constraint in the
   type.
5. **The chain walk has two homes** (§6, F→D): `chainSegmentIdsOf` in `list-session-children.ts`
   reproduces `foldSessionChains`' walk. Recorded by F; still two homes.
6. **`beginGenuineTurn`'s promise is not kept under `markPendingCheckpoint`** (R2-7) — the register's
   three states do not model "a survivor waiting its turn" distinctly from "the current intent".
7. **Observability of the pool.** `busyKeys()` exists and nothing exposes it; the yield log is
   `debug` (`run-report-delivery-tick.ts:286-289`). When Kafi's smoke asks "why is nothing running", there
   is no read that answers. A tiny `GET /activity/pool` (held keys, active count, oldest pending age)
   would be the honest replacement for the `/activity/running` seed D5 removed.
8. **Testing gap at the one seam that matters most for R2-1**: nothing asserts what
   `deriveDesktopPlanConsent` receives from a *background* composer. `desktop-plan-consent.test.ts`
   tests the pure function; no test pins "a delegated turn with no stamped mode gets display-only",
   which is exactly the invariant that broke.
9. **`run-task-job.ts` is 415 lines and `run-report-delivery-tick.ts` 577** — both over the ~300 cap,
   both recorded as deferred in §7. The delivery tick in particular now holds four kind-branches, the
   direct rail, the yield rail and the checkpoint drop; it is the next split.
10. **A user would hit**: a delegated task that takes 40 minutes leaves the workspace chat composer
    parked with a single "busy" sentinel and no elapsed time, no "stop the task" affordance from that
    surface, and no idea it will resolve. That is R2-4 experienced rather than diagnosed.

---

## 5. Monitoring binding + node display

*(server-side findings mine; the web-layer findings come from a focused read of
`apps/local-web/src/**` — see the sub-report merged below.)*

**Wire vocabulary is now correct and single-valued.** `SessionTurnScopeKind = 'global' | 'workspace' | 'voice'`
(`packages/contracts/src/chat/session-activity.ts:34`), `primarySessionId` is on
`BeginTurnActivityInput` and mirrored into `session_turns`
(`packages/session/src/runtime/session-activity-feed.ts:30-48, 109, 128`), and the two global-turn
producers both stamp it: the SSE stream (`global-root-turn.ts:334-339`, `scopeKind: isVoiceTurn ? 'voice' : 'global'`
+ `primarySessionId: conversationTarget.primarySessionId`) and the background runner
(`run-global-root-turn.ts:406-410`). **V2 closed at the source.**

**The one identity a reader still infers from an absence** is `workspace`: `chat-turn.ts:432-437`
begins with `scopeKind: 'workspace'` and *no* `primarySessionId`, and §6 (D's hand-back) states
`matchTurnToIdentity({ kind: 'workspace' })` depends on that absence. That is a load-bearing invariant
living in a doc-ask rather than in a test — see the web sub-report for whether a test pins it.

**Voice status exists now**: the fold admits `voice` (`fold-session-chains.ts:73` —
`if (tail.scope !== 'global' && tail.scope !== 'voice' && !hasListedSegment) continue`), and the
agent-visible reads drop it unconditionally (`get-sessions-overview.ts:44-46` —
"Every chain this surface may show — the voice thread removed"), with a dedicated owner-scoped door
`GET /root/voice-chat/status` → `getVoiceChatOverviewEntry` (`get-sessions-overview.ts:80-93`,
`routes/root/voice-chat.ts:104-121`). **V3 closed, and the leak D warned about is closed with it.**

**Interrupt is identity-shaped** (`routes/root/interrupt.ts:59-81`): an owner-checked `sessionId`
gated to `INTERRUPTIBLE_SCOPES = {'global','voice'}` with a 404 that does not distinguish unknown from
foreign. The no-id branch still falls back to the global head (`:75-80`) — deliberate per its header,
and §7 records that the *web* voice surface sends nothing rather than falling back. **V4 closed
server-side.**

**Enlargeability, server half:** `GET /sessions/:id/children` exists
(`routes/sessions/index.ts`, `packages/session/src/overview/list-session-children.ts`) and its
orchestration read is capped + userId-scoped and deliberately newest-first-then-reversed so the cap
drops the OLDEST, not today's children (`delegation-jobs.ts:608-637` — a direct answer to round-1's N1
class). Remaining server-side blocker for more levels: no index on `delegation_jobs.parentSessionId`
(R2-11) and the duplicated chain walk (§4.5).

### (a) Nodes view — bound to real truth? enlargeable?

**Bound to real truth: yes, and the round-1 bugs are fixed.**
- The project level now uses a **scoped** read: `apps/local-web/src/composables/nodes/use-project-nodes.ts:40-55`
  passes `{ scope: 'workspace', workspaceId }`, curated server-side BEFORE the cap
  (`packages/session/src/overview/get-sessions-overview.ts:56-70` — "filtering after the cap would hand
  back a page of 50 that yields three rows"). **N1 closed.**
- `hasAnswered` is wired at the fleet level, including an errored poll counting as answered
  (`use-fleet-nodes.ts:77-84`). **N2 closed** — but only at the fleet level (**R2-15**).
- Scene scratch is keyed by node id (`utils/constellation-scene.ts:825-867` reconciles through
  `inheritedSlots`; particles carry `nodeId`, `:94-95`), and `anchorOf` uses a `slotById` map
  (`:392-396`) instead of a per-frame `findIndex`. Layouts are count-aware
  (`utils/constellation-layout.ts:96-170`: `ORBIT_LANE_CAP = 8` + wrap, `riseStep(count, W)`,
  concentric rings past `CONSTELLATION_RING_CAPACITY = 12`). **N3 closed.**

**Enlargeable: structurally yes, practically not yet.**
- `SceneNodeRef` is minted/parsed in ONE place (`utils/constellation-node-ref.ts:48-62`) — I confirmed
  no `startsWith`/`slice` id-parsing survives elsewhere. It is a *tagged record*, not a per-kind
  discriminated union (all kinds share `{kind, id}`), which is enough for addressing but carries no
  per-kind payload.
- The level STACK is real: `views/NodesView.vue:68` `const stack = ref<NodeLevelStackEntry[]>([])` +
  `composables/nodes/node-level.ts:72-79`. **N4's boolean is gone.**
- `SceneNode.detail` exists and is produced (`constellation-scene.ts:31-40,50`; `use-fleet-nodes.ts:47-56`;
  `use-project-nodes.ts:110-127`) but is **rendered nowhere** — and `SceneHandle.hitTest`
  (`constellation-scene.ts:144`) is exported and never called by the view. F declared this in §6
  ("carried and unrendered"); it is accurate.

**What still blocks more levels / nodes / info** (concrete):
1. **No parent/child edge model in the scene.** Every node is a strand from the CORE
   (`constellation-scene.ts:484-501`, `:678-698`); `SceneNode` has no `parentId`. A hierarchy cannot be
   *drawn* at all — only transient message arcs join two non-core dots.
2. **Layout takes only a count** (`constellation-layout.ts:98-170`), so children cannot be placed near
   a parent even once edges exist.
3. **The third level's data door is unwired.** `GET /sessions/:id/children` exists
   (`apps/local-api/src/routes/sessions/index.ts:587-615`, `packages/session/src/overview/list-session-children.ts`)
   and has **zero web call sites** — the route says so itself (`:584-585`: "Nothing renders it yet").
   The SDK method is generated (`packages/sdk/src/generated/namespaced.ts:1713`).
4. **One level instance per KIND** (`node-level.ts:56-58`, `Partial<Record<SceneNodeKind, NodeLevel>>`),
   constructed at setup with `NodesView.vue:71-74` binding a fixed `workspaceId` ref — so
   session→session recursion needs a level that reads the stack top, not a fixed ref.
5. **Project node count is hard-capped at 50 with no paging and no truncation notice**
   (`use-project-nodes.ts:49-53` sends no limit → `DEFAULT_ENTRY_LIMIT = 50`). The composable's own
   header records this lesson for the *unscoped* read; the cap survived the fix (**R2-8b**, minor).
6. **R2-14** — the arcs' `to` end cannot resolve for spawned sessions at all.

The children route itself is well-built: ownership-checked with a no-enumeration 404
(`routes/sessions/index.ts:613-615`), userId-scoped and capped reads, and the job list is
newest-50-then-reversed so the cap drops the OLDEST rather than today's children
(`packages/orchestration/src/repositories/delegation-jobs.ts:618-637`) — the direct answer to
round-1's N1 class. Its two caps do silently drop data on a very long-lived account (the chain walk
runs through `listAllChatSessionsForUser`, capped at 500 and filtered `isArchived = false`), which is
unobservable today but a trap for whoever wires level 3.

### (b) The wider live binding

**Identity matching is now one helper with four honest predicates**
(`apps/local-web/src/composables/activity/match-turn-to-identity.ts:31-53`): `primary` = id equality,
`voice` = `scopeKind === 'voice'`, `global` = `scopeKind === 'global'` (documented at `:20-24` as a
FAMILY that must never bind a view to a session), and `workspace` = scope + workspaceId +
`primarySessionId === null`. `turn.primarySessionId ?? null` is normalised once at `:35`, so omitted
and explicit-null behave alike.

**Can the Global chat still bind or render the voice thread? No** — traced five ways:
`use-continuing-conversation.ts:66-69` matches `{kind:'primary', primarySessionId: rootSessionId}` and
the two ids are provably different (pinned by `apps/local-api/src/streams/global-root-turn.test.ts:263-278`);
`use-session-statuses.ts:44-71` has no global-family branch; the voice chain cannot reach the shared
overview at all (`get-sessions-overview.ts:46`, `packages/contracts/src/chat/sessions-overview.ts:86`);
`use-watched-turn.ts:39-52` subscribes by session id; `use-session-detail.ts:57-70` uses a different
door than `root.getVoiceTranscript()`. **V2's client half closed.**

**Voice status is wired end to end**: the shell's global light aggregates global ∪ voice through a
pure rank-min fold (`components/shell/AppShell.vue:312-314` → `components/shell/global-area-status.ts:29-36`,
tested), and the Voice chat menu row wears its own mark (`AppShell.vue:280-295` →
`AppSidebar.vue:217-222`), sourced from the walled-off `GET /root/voice-chat/status` via
`composables/sessions/use-voice-chat-status.ts:34-60`, which reuses `deriveSessionStatus` — one ladder,
not a new one. **V3's client half closed.**

**Drift that remains:** `globalStatusView` and `use-workspace-status.globalStatus` no longer rival
each other (the former has exactly one consumer, `use-workspace-status.ts:125`), but voice is
double-counted through `hasGlobalServerTurn` (**R2-17**), `TasksPanel` first-matches the global family
(**R2-16**), `globalServerTurnOrigin` has no consumer left, and **R2-13** is the live regression.

**Desktop overlay Stop is identity-shaped now** (`views/DesktopControlOverlayView.vue:124-148`): three
routes (`voice` by session id, `global-root` by `primarySessionId === globalPrimaryId`, delegation),
refusing otherwise — "Refusing beats stopping the wrong turn" (`:129-133`). The fold carries
`sessionId` and `primarySessionId` and updates both on `turn-updated`
(`stores/desktop-activity-fold.ts:51-60, 256-285`). D's §6 ask to C was folded correctly.

**Voice web legs (C):** the panel sends `voice: true` (`components/chat/VoiceChatPanel.vue:92-96` →
`composables/chat/use-chat-turn.ts:174`) and the tier constants explicitly, ignoring the composer's
emitted settings (`:147-150`); it passes NO `sessionId` to the composer with the reason in the
template (`:212-217`) and locks the chips; its poll predicate is `scopeKind === 'voice'` (`:58-62`).
The E3 coupled fix is present on both sides: `composables/voice/use-voice-daemon-link.ts:40,78-82`
takes `isPlayingOwnTurn` and both mount sites pass it (`views/JarvisView.vue:27-31`,
`components/voice/VoiceOverlay.vue:21-24`). Voice Stop refuses rather than falling back —
`use-chat-turn.ts:310-312`: "A VOICE surface that does not yet know its session … must NOT send the
empty body". **§7's review fold verified.** One product gap, not a bug: a *daemon-started* voice turn
has no Stop in the panel at all (the button is `v-if="streaming"`, bound to the panel's own engine,
`VoiceChatPanel.vue:218`); only the desktop overlay can stop one, and only while it drives desktop
tools.

---

## 6. Session continuity everywhere

**Coverage is enforced by construction now.** `packages/session/src/runtime/continuity-census.test.ts`
is a source-tree guard: it asserts the set of files calling `consumeSessionEventStream` equals the set
calling `withBoundaryContinuity`, and pins the 5-runner roster (`:31-38`). A sixth runner that forgets
the wrapper fails before it lands. This is the single best structural improvement in the arc.

**Durability landed properly.** The register IS the identity's row — four nullable columns with three
explicit states (none / pending / handed-over), `db` first, sync
(`packages/session/src/continuity/pending-checkpoints.ts:32-179`; migration
`0050_session_hardening_durable_state.sql`). The follow-up job's id is persisted
(`markContinuationJob` / `takeContinuationJob`), so a restart between enqueue and claim changes
nothing, and `beginContinuation`'s depth lives on the same row so the cap counts across restarts.
`enqueueCheckpointContinuation` does depth + row + hand-over in ONE transaction (`:111-125`).

**Where it can still break, ranked:**
1. **R2-2** — the voice thread's survivor is immortal and silent. The only identity where the arc's
   own "a promised continuation survives a restart" claim does not hold.
2. **R2-7** — a survivor displaced by a fresh checkpoint disappears with no note.
3. **`swapping-primaries` is still process-wide** (`packages/session/src/continuity/swapping-primaries.ts:10`)
   — deliberate and correct (it is a *live* signal, cleared in `bridgePrimarySession`'s finally; a
   crash mid-swap leaves nothing to clear), but it means a restart mid-swap shows "busy" instead of
   "patching context" on the first queued turn. Cosmetic; recording it so the next reader does not
   re-derive it as a durability gap.
4. **Concurrent global + voice on one cwd** — still unexamined (§2 records it as a live-smoke item).
   I confirmed the two *are* genuinely concurrent (separate lock keys,
   `root-turn-lock.ts:28-30`) and that `resolveVoiceConversationTarget`
   (`resolve-global-root-conversation.ts:46-61`) hands back the same hidden global cwd shape. Two
   `runSeededSwapSession` primings in one directory at the same instant remains the open question.
5. **The denominator on rows with no chosen model** (R2-12).
6. **Carry tail** — G4 landed: the budget SKIPS an over-long line and leaves a marker instead of
   `break`ing (`build-continuity-context.ts:159-171,185`). Closed.
7. **whoami and the swap now agree** — `resolve-whoami-report.ts:126` reads
   `resolveSegmentContextWindow(db, ownedSegment.id).contextWindow`. G4 closed.

**Improvements:** (a) give the register a fourth state or a note for the displaced-survivor case;
(b) make "does this identity ever auto-continue" a property of the identity, not of the turn's flag —
that single change closes R2-2 and makes the delivery-vs-voice distinction legible; (c) the survivor
info line at `run-turn-with-continuations.ts:82-86` should be a `warn` with the age, since on the
voice thread it is currently a lie repeated forever.

---

## 7. Score — **8 / 10** (round 1: 7 / 10)

| Axis | R1 | R2 | Why |
|---|---|---|---|
| Correctness | 6.5 | **8** | every round-1 P1 closed at the source, most with a seam test — a large, real jump. Held back by three NEW defects, two of them regressions the arc itself introduced (R2-1, R2-13) |
| Stuck-resistance | 5 | **8.5** | lease + heartbeat + sweeper + hard cap + three wall clocks + two 60 s reapers + the daemon watchdog, and the cap provably suspends across a human decision. Two holes: the channel runner (R2-3), the uncancellable target-lock wait (R2-4) |
| Settings integrity | 6.5 | **8** | one rule, two homes, birth-stamped children, fit on every pick, voice provably one-way and 403-locked. Docked for R2-1/R2-6 — `permissionMode` quietly became an *authority* token and only its approval consumer was audited — and leaf rows |
| Observability | 7 | **8** | `'voice'` first-class on the wire, `primarySessionId` on every global begin, one `matchTurnToIdentity`, a voice-status door that cannot leak into `list_sessions`. Docked for R2-13 (a live rail regression), R2-16/R2-17, and no pool/lock read (§4.7) |
| Continuity | 8 | **9** | durable register, one-transaction hand-over, the census guard, denominator + carry + whoami fixed. Docked for R2-2/R2-7 |
| Voice | 5.5 | **8.5** | tier forced on all four legs, no card, no PATCH, own status mark, identity-shaped Stop that refuses rather than falls back, watchdog + connect deadline, recoverable-≠-failed, E3 shipped in both halves. Docked for R2-2 and R2-13's rail chip |
| Tests | 7.5 | **8.5** | the `apps/`↔`packages/` seams round 1 called untested now have `hard-cap.test.ts` (lock lifetime, cap suspension, heartbeat, recoverable delivery), the continuity census, the settings suite, stream suites. But **two of my three P1s are defended by tests pinning a pre-arc wire shape** (R2-13's fixture; nothing at all for R2-1's seam) |
| Code health | 8 | **8** | the 911-line tick split cleanly into four files with real headers; every stale comment round 1 named was corrected. New over-cap files (`run-report-delivery-tick.ts` 577, `run-task-job.ts` 415), and two comments made newly false by the arc (`desktop-plan-consent.ts:5-8`, `build-workspace-background-mcp.ts:265-270`) |

**Why 8 and not 9+.** The engineering inside each slice is excellent — the delegation engine is now
the strongest code in the repo and I could not break its single-writer invariant by reading. What
holds it back is one repeated pattern, and it is the same pattern three times:

> **The arc changed two cross-cutting FIELDS — `permissionMode` and `primarySessionId` — and audited
> only the consumers inside the slice map.**

- `permissionMode` has three consumers: the approval policy (audited), the delegation-mode header
  (audited), and **`deriveDesktopPlanConsent` (not audited)** → R2-1.
- `primarySessionId` has several readers: `matchTurnToIdentity` (audited), `use-session-statuses`
  (audited), the overlay fold (audited), and **`use-working-rail` (not audited)** → R2-13.
- Both regressions are *defended by green tests that construct the pre-arc frame*, which is why
  108/108 typecheck and 5 791 tests stayed green.

That is exactly the "after fixing, sweep the codebase for the same pattern" step in CLAUDE.md, and it
is the whole gap between this and the 9+ Kafi asked for. The fixes are small; the missing step was a
consumer census per changed field, not more code.

**+1 (to 9):** R2-1 (desktop consent reads attendedness + the false comments + a seam test), R2-13
(reorder the rail branch + refresh the fixture), R2-2 (voice survivor). All three are local, and
together they retire the pattern above.

**+2 (to 10):** the claim token (R2-5), a bound + abort on `SessionTargetLocks.acquire` (R2-4), the
channel runner's wall clock (R2-3, the last hole in the arc's own acceptance bar), R2-14 (the arcs'
`to` id space), and one pool/lock diagnostics read (§4.7).

---

## 8. Voice session review

**Trace, re-verified end to end.**

Wake: `VoiceSessionDriver.#handleSegment` (`voice-session-driver.ts:222-248`) → `#runTurn`
(`:250-287`) arms `armTurnWatchdog(VYNEL_VOICE_TURN_WATCHDOG_MS)` (default 300 000,
`apps/voice/src/env.ts:79`) and races it against `#consumeBrainTurn` →
`createBrainClient` POSTs `/root/turn { userMessageText, model: tier, thinkingEffort: low, mode: auto, voice: true }`
with the watchdog's `AbortSignal` and a 10 s connect deadline (`run-brain-turn.ts:68, 92-96, 175-189`)
→ `streamGlobalRootTurn` branches on `input.voice` (`global-root-turn.ts:146`) →
`resolveVoiceConversationTarget` (own `scope:'voice'` primary) → tier forced, no row read, no
write-through (`:118-120`), fit-clamped (`interactive-turn-settings.ts:84-97`) → `ask_user` NOT
attached (`:217-227`) → feed `begin({ scopeKind:'voice', primarySessionId })` (`:95-100`) →
`turn-queued { busy | context-patching }` before parking (`:162-167`) → core locks `${userId}:voice`
(`root-turn-lock.ts:28-30`) → `autoContinue: false` (`:205-207`) → `withBoundaryContinuity` → the
reply arrives via the `speak` tool → `onSpeak`'s four-party router (`apps/voice/src/main.ts:154-173`).

**What is right, and is new:**
- The **call leg** now sends `{ mode: VOICE_TIER_MODE, voice: true }` (`call-session-client.ts:43-49`)
  and the server enforces the tier regardless (`session-turn.ts:106-112`) — V1 closed on both sides.
- The **watchdog** hands the room back and leaves the server turn alone; the reply still arrives
  through `speak` (`voice-session-driver.ts:272-281`). The abandoned SSE read is aborted, and
  `streamTurnEvents` distinguishes "the watchdog stopped this read" from a real break
  (`run-brain-turn.ts:151-160`).
- **E3's coupled fix shipped**: the handed-off branch publishes to the overlay and falls back to native
  when the client is gone (`main.ts:156-162`), replacing the silent no-op.
- `mapFrameToBrainEvent` no longer apologises for a recoverable blip (`run-brain-turn.ts:38-47`), and
  a `turn-queued` frame becomes a spoken "One moment." exactly once per turn
  (`voice-session-driver.ts:296-302`).
- **Stop** reaches its own thread (`routes/root/interrupt.ts:59-73`), and the voice row cannot be
  PATCHed at all (`update-chat-session-settings.ts:44-47`).
- The voice/global **wall** holds where it must: `getSessionsOverview` drops voice unconditionally
  (`get-sessions-overview.ts:44-46`) and the only reader is the owner-scoped `/root/voice-chat/*` door.

**Where it still breaks / sticks / drops, ranked:**
1. **R2-2 (P1)** — an immortal, silent checkpoint survivor. The only voice-specific correctness defect
   I found, and it is a direct interaction between C3's `autoContinue: false` and G1's durable register.
2. **R2-1 (P1)** — a voice turn runs `auto`, therefore `standing-consent`: "hey Vynel, sort my
   desktop out" actuates with no gate. That is arguably intended for a hands-free surface, but it is
   the *same* switch that gave a Telegram message the same authority, which is not.
3. **Second utterance during a watchdog-abandoned turn (P2, PLAUSIBLE).** After the watchdog fires the
   driver returns to `active` (`voice-session-driver.ts:278`), so the next utterance starts a SECOND
   `/root/turn`. The server serialises it on `${userId}:voice` and the daemon says "One moment", so
   nothing corrupts — but the user now has two turns queued on one thread and the first one's `speak`
   can land *after* the second's, out of order. Worth naming in the smoke.
4. **Speak-queue kick depends on mic frames (P3, PLAUSIBLE).** `pushAudio` early-returns while
   `busy` *before* its `finally` (`:92`), and `#leaveTurn` → `#goActive` does not kick, so a `speak`
   queued mid-turn drains on the next `pushAudio`. Fine while the mic streams continuously; a device
   that stops delivering frames strands the line. One `this.#kickSpeakQueue()` in `#goActive` closes it.
5. **Voice `speak` still cannot be routed by producer** (`main.ts:139-145` says so) — the coupled
   client-side guard is the mitigation, not a fix. `/speak` carrying a producer id would end the class.

**Is continuity applied?** Yes and correctly: the voice leg rides `runGlobalRootTurnCore` →
`withBoundaryContinuity` (census-guarded), swap segments inherit `scope: 'voice'`
(`run-global-root-turn-core.ts:307-310` + the two swap writers per §6), and the fold's voice branch
keys on the tail scope. The one hole is R2-2.

**The open forks — my verdict:**

| Fork | Verdict |
|---|---|
| `direct_to_user` answers reach only the global catch-up net | **Now worth doing, and cheap.** G2 is closed (the net is marked on `session-started`, `run-global-root-turn-core.ts:253-271`) and V6 is closed (E3 shipped), so both blockers round 1 named are gone. The remaining work is small: a `direct-delivery` whose requester is the voice thread has no rail. Do it after R2-2. |
| Voice-fired TASKS parent on the global conversation | **Still correct — but the reason changed.** Round 1 kept it because voice had no status. Voice now HAS status (`/root/voice-chat/status`), so the argument is now positive rather than defensive: reports are the global ledger's (`compose-global-root-provider-message.ts:53-61` states it), and a voice-fired task's report belongs where the user reads reports. Leave it, and delete the "revisit after V3" note. |
| Per-call sessions gain the routing toolset | **Unblocked.** Round 1's precondition was V1 + W1; both are closed — the call leg runs `auto` with the tier and cannot card, and `ask_user` is not attached. The remaining consideration is R2-1: adding routing tools to a call session means a live phone call can delegate desktop-actuating work under standing consent. Gate this behind R2-1's fix. |
| Split `routes/root/index.ts` | **Done** (`interrupt.ts`, `voice-chat.ts`, `delegations.ts` are separate files now). |

---

## Round-1 P1 closure table

| ID | Round-1 finding | Status | Evidence |
|---|---|---|---|
| **L1** | Delegation timeout releases the target lock under a live turn | **CLOSED** | `route-request.ts:17-27` (the envelope settles only when the delegate settles), `:105-156`; `delegation-service.ts:188-209` (release in the tick's own `finally`); regression test `run-delegation-claim-and-run-tick.hard-cap.test.ts:151` ("two jobs on one target never run concurrently…") |
| **V1** | Voice CALL leg runs `ask` | **CLOSED** | `session-turn.ts:106-112` → `interactive-turn-settings.ts:67,78-103`; daemon also sends it (`call-session-client.ts:43-49`); no write-through (`session-turn.ts:303`) |
| **V2** | Voice announces as `scopeKind:'global'` with no `primarySessionId` | **CLOSED** | `global-root-turn.ts:334-339`; `contracts/chat/session-activity.ts:34`; background runner too (`run-global-root-turn.ts:406-410`) |
| **V3** | Voice chain never enters the overview → no status anywhere | **CLOSED** | `fold-session-chains.ts:73`; `get-sessions-overview.ts:44-46, 80-93`; `routes/root/voice-chat.ts:104-121` |
| **W1** | Unbounded approval / `ask_user` waits on card-less surfaces | **CLOSED** | three ways: `auto` no longer cards at all (`tool-approval-policy.ts:108`); the reaper's denial provably un-parks the gate (chain in §2 row 2); `ask_user` not attached on voice (`global-root-turn.ts:217-227`) nor on any routed turn (4 call sites, all interactive/channel); daemon watchdog + connect deadline |
| **G1** | One parked ask wedges the `${userId}` root lock → channels + deliveries starve | **PARTIAL** | delivery half CLOSED (yield, `run-report-delivery-tick.ts:279-291`; asks bounded at 2 h + a 60 s reaper). Lock half OPEN for the channel runner — no wall clock (**R2-3**) |
| **G2** | Catch-up marked surfaced before `startChatSession` | **CLOSED** | `run-global-root-turn-core.ts:253-271` + `markCatchUpSurfacedOnSessionStarted` (`:344-356`); `compose-global-root-provider-message.ts:8-13` documents the move |
| **V4** | Voice-panel Stop interrupts the GLOBAL primary | **CLOSED (server)** | `routes/root/interrupt.ts:59-81`, owner-checked, `INTERRUPTIBLE_SCOPES` gated |
| **M1** | Fit guard has one caller | **CLOSED** | now 3 homes covering every path: `resolve-background-turn-settings.ts:77` (all delegated + delivery + agent-run), `interactive-turn-settings.ts:85` (voice), `run-global-root-turn.ts:270` (channels) |
| S1 | No lease; `acquire()` unbounded; no wall clock | **PARTIAL** | lease + heartbeat + sweeper CLOSED; wall clock CLOSED on 3 of 4 holders (**R2-3**); `acquire()` still unbounded (**R2-4**) |
| S2 | No `turn-queued{busy}` on global/voice | **CLOSED** | `global-root-turn.ts:401-406` via `isRootTurnLockBusy(rootTurnLockKey(...))` |
| V5 | Voice auto-continue vs departed daemon | **CLOSED** | `global-root-turn.ts:444-446` |
| V6 | `onSpeak` handed-off branch is a no-op | **CLOSED** | `apps/voice/src/main.ts:156-162` |
| V7 | Two modes / two models on one voice thread; chips PATCH | **CLOSED** | tier forced on every leg; `updateChatSessionSettings` 403s a voice row |
| D1 | Global delivery budget not suspended; capped delivery terminal; double-delivery | **CLOSED** | gate marked from the injected runner (`run-global-root-turn.ts:539-551`), capped delivery requeues (`run-report-delivery-tick.ts:530-548`), stable inbound id + `insertChatMessageIfAbsent` |
| D2 | Restart destroys claimed `note` / `direct-delivery` | **CLOSED** | `ORPHAN_REQUEUE_JOB_KINDS` (`delegation-jobs-recovery.ts:29`), attempts deliberately not bumped |
| C1 | Process-wide `pending-checkpoints` | **CLOSED** | DB-backed (`pending-checkpoints.ts`, migration 0050). `swapping-primaries` stays in-process by design |
| T1 | Mode inversion / default asymmetry | **CLOSED** | mode stamped unconditionally in all three streams; one default everywhere |
| T2 | Spawned / agent / leaf born NULL | **PARTIAL** | spawned CLOSED (`routes/sessions/index.ts:83-106`); leaf still NULL (`record-leaf-session.ts:49-66`) — deferred in §7, behaviourally covered |
| T3 | Agent-run effort / follow-up drops effort + origin | **CLOSED (effort)** | `enqueue-checkpoint-continuation.ts:161`; `origin` deferred with a stated reason (`:178-180`) |
| T4 | `autoBuildout` read by no runner | **CLOSED** | resolved in both homes and consumed at all four runner sites (`global-root-turn.ts:437`, `chat-turn.ts:331`, `session-turn.ts:347`, `start-chat-turn.ts:187-188`); stale comments corrected (`ui-store.ts:121-127`, `chat-sessions.ts:116-121`) |

**§6/§7 claims I checked rather than believed:** ask 1 (the two `autoBuildout` spreads) — **shipped**,
`chat-turn.ts:331` and `session-turn.ts:347`. Ask 3 + ask 4 (stale comments) — **fixed**. Ask 5 (leaf
rows) — **still open**, as §7 says. The E3 coupled fix — **both halves present** (daemon at
`main.ts:156-162`; web half per the sub-report). The env knobs — **all six present with the documented
defaults**, plus a cross-check that refuses a heartbeat that cannot renew inside the lease
(`apps/local-api/src/env.ts:72-88, 187-192`).

---

## Top 10, ranked

| # | ID | Sev | One line | Where | Status |
|---|---|---|---|---|---|
| 1 | **R2-1** | P1 | the `auto` default widened desktop `standing-consent` to every turn where nobody ever PICKED a mode — Kafi's 08-11 ruling still stands, its premise moved | `desktop-plan-consent.ts:12-25` · `resolve-background-turn-settings.ts:69-73` · `run-task-job.ts:275` · `build-workspace-background-mcp.ts:255-270` | CONFIRMED |
| 2 | **R2-13** | P1 | the `primarySessionId` stamp broke the working rail: the user's own global turn rails as "Working…", a Telegram turn loses its "Claude" chip, a voice turn's chip opens a 404 | `use-working-rail.ts:127-150` · `WorkingRail.vue:33,57-58` | CONFIRMED |
| 3 | **R2-2** | P1 | a restart-survivor checkpoint on the voice thread is never continued, never dropped, never mentioned | `run-turn-with-continuations.ts:91-97` · `global-root-turn.ts:444-446` | CONFIRMED (repro) |
| 4 | R2-3 | P2 | the channel-driven global turn is the one root-lock holder with no wall clock and no cap | `channels-service.ts:90` → `run-global-root-turn.ts` (no clock) | CONFIRMED |
| 5 | R2-4 | P2 | `SessionTargetLocks.acquire` is unbounded + uncancellable; a user turn can park for the full 60-min cap | `session-target-locks.ts:28-35` · `chat-turn.ts:550` | CONFIRMED |
| 6 | R2-5 | P2 | terminal writes CAS on status, not on claim identity — a dead run's late requeue can burn a message's attempts | `delegation-jobs.ts:349-375` · `classify-turn-failure.ts:58-66` | CONFIRMED |
| 7 | R2-6 | P2 | `mutatingToolNames` (the "always card" floor) is inert on every default session | `tool-approval-policy.ts:103-113` | CONFIRMED |
| 8 | R2-14 | P2 | project message arcs can never land on a spawned session — server sends a primary id, client maps segment ids | `list-recent-message-edges.ts:76` vs `use-project-nodes.ts:157-160` | CONFIRMED |
| 9 | R2-7 | P2 | a fresh checkpoint silently displaces a survivor the loop just promised to continue | `pending-checkpoints.ts:74-87` · `run-turn-with-continuations.ts:80-86` | CONFIRMED (repro) |
| 10 | R2-18 | P3 | the workspace-identity invariant (`primarySessionId` absent) has no server-side test — latent P1 | `chat-turn.ts:431-437` · `match-turn-to-identity.ts:45-49` | CONFIRMED |

Also open, ranked below the ten: R2-16 (TasksPanel first-match) · R2-17 (voice double-count) ·
R2-15 (project dots paint before the status poll) · R2-9 (cap/settle race) · R2-8 (direct-reply id) ·
R2-10 · R2-11 (missing indexes) · R2-12 (denominator).

---
