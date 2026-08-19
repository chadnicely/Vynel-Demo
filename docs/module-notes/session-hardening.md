# Session hardening — the 9+ arc (2026-08-19)

Input: `docs/audits/session-2026-08-19/README.md` (five-agent audit, verdict 7/10). Goal set by Kafi:
**9+ / 10, solid.** This note is the plan: Kafi's decisions (§1), the assumptions the lead made
(§2), the slices with file OWNERSHIP so parallel agents never collide (§3), the acceptance bar per
slice (§4), and the integration protocol (§5). Branch: `feature/session-audit` (worktree
`.claude/worktrees/session-audit`, band 18940). Slice branches: `feature/sh-<letter>` off it.

---

## 1. Decisions (Kafi, 2026-08-19 — locked)

| # | Decision | Consequence |
|---|---|---|
| D1 | **Voice never cards. Channels run the global row's mode when set, else `auto` (security hardening later).** | Voice turns run `auto` (SDK auto — no Vynel card of any kind; Claude's own safety check applies). Channel runner resolves `row.sessionMode ?? DEFAULT`. |
| D2 | **Voice thread = sonnet-5 / low / auto on EVERY leg** (wake, call, overlay, typed panel). No card "through voice or chat". Chips read-only. | Server enforces the tier for `voice` turns regardless of input; nothing is written to the voice row; the panel shows read-only "Hands-free" chips. |
| D3 | **`DEFAULT_SESSION_MODE` → `auto` for everything** ("Anthropic already set auto default … one day ask will be gone"). | Every `?? 'ask'` and every unattended `?? 'bypass-with-behavior-gate'` fallback resolves the same default. Users who explicitly picked Ask/Bypass keep it (persisted). |
| D4 | **Children inherit the creator's resolved settings; tool args override.** | Spawned/agent sessions are birth-stamped from the creating turn's row; delegated turns resolve `tool arg ?? target row ?? default`; agent runs carry effort like personas. |
| D5 | **Bounds (env-overridable):** delegated run holds its lock for the WHOLE run, hard cap 60 min → abort + honest failure delivery, clock suspended while parked; interactive turn 60 min wall clock (suspended while parked) → interrupt + failure row; `ask_user` NOT attached on voice; interactive ask 2 h + a 60 s reaper; channels 10 min; approval reaper stays 5 min ×2; voice daemon watchdog 5 min; job lease heartbeat 30 s / expiry 3 min; continuation cap 3. | Knobs: `VYNEL_DELEGATED_TURN_MAX_MS` `VYNEL_INTERACTIVE_TURN_MAX_MS` `VYNEL_INTERACTIVE_ASK_MAX_MS` `VYNEL_DELEGATION_LEASE_MS` `VYNEL_DELEGATION_HEARTBEAT_MS` (local-api env), `VYNEL_VOICE_TURN_WATCHDOG_MS` (voice env). |
| D6 | **Migrations OK:** pending checkpoint on `primary_sessions`; lease on `delegation_jobs`; `'voice'` feed scope; `chat_sessions.lastContextWindow`. | All additive + nullable, drizzle-generated (never hand-written), copy-forward where relevant. |
| D7 | **Nodes: bugs + enlargeable structure, NO new visuals.** Voice is a CHILD of global in the model. Layout redesign (workspace/global as suns) is Kafi's later UI pass. | `SceneNodeRef` union + level stack + detail bag + count-aware layouts + `GET /sessions/:id/children`; screen looks the same. |
| D8 | **`autoBuildout` = autopilot.** "Claude needs to know he is on autopilot; the user is probably not available; continue by yourself; make the best-fit decision, researching with spawned agents if a decision needs grounding; if stuck, set status `needs_input`." | Resolved like the other settings; when true a per-message autopilot marker rides the provider input (system-prompt blocks decay on long sessions — the voice-marker precedent). Inherited by children (D4). |

## 2. Lead assumptions (stated so they can be overruled)

- **Stamp the RESOLVED mode always** on the interactive streams (parent == child). The 08-19 "only when
  resolved" choice protected global parity; with one default everywhere it is moot, and the inversion
  (mode-less parent `ask`, children unattended) was a safety hole.
- **`bypass-with-behavior-gate` stops being a fallback anywhere.** It stays a valid provider mode; no
  Vynel path reaches it by default. The floor set stays defined for `ask` + explicit-bypass semantics.
- **Voice `autoContinue: false`** (STATE.md records voice auto-continue as deferred; the daemon returns
  at the first `session-completed`; continuations would run unheard holding the voice lock).
- **`ask_user` on the voice thread is not attached** (D5); the model asks in speech; the next utterance is
  the answer. On explicit-Ask threads elsewhere cards keep working as today.
- **Delivery / update / direct / note turns and schedule fires** resolve the requester row's mode
  `?? DEFAULT` (D3) — no more hardcoded NULL→unattended.
- **Restart policy:** claimed `note` and `direct-delivery` rows REQUEUE at boot like `report-delivery`
  (a note is a handed-over thought, a direct-delivery is a final answer). Lease-expired rows follow the
  same kind rule.
- **Continuation settings** stay pinned to the checkpointing turn (already the case for interactive
  continuations and for the follow-up job) — no change, recorded as settled.
- **`/activity/running`** (the "rebuild seed" with no consumer) is removed with its SDK method — after a
  restart every turn is reaped, so there is nothing to rebuild from; the durable `session_turns` mirror
  stays for facts.
- **Voice status placement:** the Voice chat menu row wears its own mark; the shell's global light
  aggregates global ∪ voice (voice is a child of global, D7).
- **The interactive interrupt** becomes identity-shaped (`sessionId`), owner-checked against a
  global-or-voice chain — the same door per-call sessions will use.
- **Global + voice sharing one cwd** for concurrent seeded swaps: unexamined by five agents, no
  corruption found; NOT in scope — recorded as a live-smoke item.
- **The 911-line tick** is split at the kind branch ONLY after its functional changes land and are
  green (Slice A step 2), never in the same commit.

## 3. Slices + ownership (parallel agents, one worktree each)

Wave 0 (lead, on `feature/session-audit`, before any fan-out): `DEFAULT_SESSION_MODE = 'auto'` +
every test pin; `VOICE_TIER_MODE = 'auto'` beside the pins; the four schema changes generated
(`primary_sessions.pending_checkpoint_{next_step,depth,at,job_id}`, `delegation_jobs.lease_expires_at`
+ `heartbeat_at`, `chat_sessions.last_context_window`; `'voice'` widened on the `session_turns.scopeKind`
TS type + `SessionTurnActivity.scopeKind` wire enum + `BeginTurnActivityInput`); env knobs (D5) with
documented defaults; `EnqueueAgentRunInput.thinkingEffort` + its insert; `startPausableTimeout` extracted
from `route-request.ts` into an exported `pausable-timeout.ts`; a `voice?: boolean` field on
`StartSessionTurnRequestSchema` + `StartChatTurnRequest`; this note. Green (typecheck + touched suites)
then committed. Every slice branches from that commit.

| Slice | Model | Owns (nobody else edits these) | Delivers |
|---|---|---|---|
| **A · Delegation engine** | fable | `packages/orchestration/src/**` (except `pausable-timeout.ts` once extracted), `packages/session/src/delegation/**` EXCEPT `enqueue-checkpoint-continuation.ts`, `packages/session/src/runtime/{run-global-root-turn-core,compose-global-root-provider-message}.ts`, `apps/local-api/src/services/delegation-service.ts`, `apps/local-api/src/sessions/run-global-root-turn.ts` | A1 lock lifetime = whole run: `routeRequest` no longer resolves `timed-out` while the delegate runs; the hard cap (`VYNEL_DELEGATED_TURN_MAX_MS`, pausable via the wait gate) requests cancel through the cancel registry → interrupt → the run settles → job `failed: exceeded the N-minute cap` + failure delivery; the pool releases the key only when the delegate promise settles. **Regression test: a capped run does not free its key until its turn settled; two jobs on one target never run concurrently.** A2 lease: claim sets `leaseExpiresAt`; a 30 s heartbeat extends it; a 60 s sweeper handles expired leases by kind (report/note/direct requeue; task/agent-run fail + failure delivery); boot pass widened (note + direct requeue). A3 delivery rail: the global branch marks its wait gate from approval events; a capped delivery is recoverable (requeue once); notify retry is idempotent (an existing attribution/ref key, else add `deliveryJobId` to the inbound row via a generated migration); the two bare writes become one transaction. A4 catch-up: `markDelegationsSurfacedToRoot` moves to AFTER the turn is underway (`session-started` / first persisted user row) — the compose function returns `jobIds`, the core marks. A5 settings on delegated turns: `delegate-to-*` resolve mode/model/effort as `job ?? target row ?? DEFAULT`; `fitPinnedModelToSession` applied to every delegated/agent-run model (incl. `agent.model`); channel runner resolves `row.sessionMode ?? DEFAULT`; global core's `?? 'bypass-with-behavior-gate'` → `?? DEFAULT`; the core appends the autopilot marker when the resolved `autoBuildout` is true (B ships the instruction file; A reads `input.autoBuildout`). A6 (after A1–A5 are green, separate commit): split the tick at the kind branch (`run-task-job.ts` / `run-note-job.ts` siblings) — behaviour-neutral. |
| **B · Settings & modes** | opus | `packages/chat/src/settings/**`, `packages/session/src/spawned/**`, `packages/session/src/runtime/start-chat-turn.ts`, `packages/instructions/**` (new `autopilot-marker.md` + id), `apps/local-api/src/routes/sessions/index.ts` (the `POST /sessions/spawned` birth-stamp only — coordinate with F who adds a children route in the same file: B edits the create handler, F appends a route; rebase order B → F), `apps/local-api/src/sessions/composer-mention-turn.ts`, `apps/local-web/src/components/chat/VoiceChatPanel.vue`, `apps/local-web/src/components/chat/AppComposer.vue` (read-only chips prop), `apps/local-web/src/composables/voice/**`, `apps/local-web/src/composables/chat/use-session-settings.ts` | B1 `resolveTurnSessionSettings` returns `autoBuildout`; the autopilot marker rides the provider input on the workspace/DM path (`start-chat-turn.ts`) when true (A does the global core). B2 birth-stamp: `POST /sessions/spawned` reads the ambient turn-session's row (the creator's `chat_sessions` row already holds the resolved chips via write-through) and passes mode/model/effort/autoBuildout to `createSpawnedSession` → `recordSpawnedSessionSegment` writes them; a call-leg create (no ambient turn) stays NULL and gets the voice tier from C. B3 `@agent` mentions carry `thinkingEffort` (field landed in Wave 0). B4 voice web legs: the overlay leg and the panel send the tier incl. `mode: VOICE_TIER_MODE`; VoiceChatPanel passes NO `sessionId` to the composer (no PATCH), shows read-only "Hands-free" chips (AppComposer gains a `readonlySettings`/`settingsLocked` prop), and its poll predicate becomes `scopeKind === 'voice'`. B5 `use-session-settings`: guard — a `voice`-scope row cannot be PATCHed (server: `updateChatSessionSettings` refuses `voice` scope with a typed error). Tests for every home. |
| **C · Streams & bounds** | fable | `apps/local-api/src/streams/**`, `apps/local-api/src/routes/{sessions,chat}/schemas.ts`, `apps/local-api/src/sessions/{delegation-mode-header,turn-session-header}.ts`, `packages/session/src/runtime/root-turn-lock.ts`, `packages/asks/**`, NEW `apps/local-api/src/services/asks-recovery-service.ts`, `apps/local-api/src/boot.ts` (wiring lines only), NEW `packages/session/src/runtime/turn-wall-clock.ts` | C1 stamp the resolved mode always (chat-turn, session-turn). C2 voice gates on `session-turn.ts` (`input.voice`): tier mode/model/effort forced, no row read/write, fit clamp; the call leg is thereby closed. C3 `global-root-turn.ts` voice leg: mode forced `auto` (explicit), tier forced over any input, `ask_user` not attached, `autoContinue: false`, feed `begin({ scopeKind: 'voice', primarySessionId })`; global turns stamp `primarySessionId` too; `turn-queued { reason: 'busy' }` via a new `isRootTurnLockBusy(lockKey)`. C4 interactive wall clock: ONE helper (`turn-wall-clock.ts`, built on `pausable-timeout` + the ask/approval park events) used by all three streams: `VYNEL_INTERACTIVE_TURN_MAX_MS`, suspended while an approval or ask is parked, on expiry `interruptChatSession` + failure row "turn exceeded the N-minute limit" + `turn-ended failed`. C5 asks: interactive descriptor gets `timeoutMs = VYNEL_INTERACTIVE_ASK_MAX_MS`; new 60 s `asks-recovery-service` calls `expireAskRequests` with the same bound (orphans after a waiter died). C6 (should) `chat-turn.ts` non-continue path: if `resumeSessionId` is a live primary's head, take that primary's key. Tests: stream suites for every gate, the wall clock (fake timers), `turn-queued busy`, feed scope. |
| **D · Monitoring identity, voice status, interrupt, root routes** | opus | `apps/local-web/src/stores/**`, `apps/local-web/src/composables/{sessions,activity}/**`, `apps/local-web/src/composables/chat/{use-chat-turn,use-continuing-conversation,use-watched-turn,use-session-detail}.ts`, `apps/local-web/src/components/{sessions,activity,sidebar,shell,tasks}/**`, `packages/session/src/overview/**` (except F's new `list-session-children.ts`), `apps/local-api/src/routes/root/**`, `apps/local-api/src/routes/activity/**`, `packages/contracts/src/chat/{session-activity,sessions-overview,session-status}.ts` | D1 identity readers: `runningPrimarySessionIdFor`, `liveTurnStartedAtForEntry`, `hasGlobalServerTurn` / `globalServerTurnOrigin` key on IDENTITY (`primarySessionId` now stamped; `scopeKind: 'voice'`) through ONE `matchTurnToIdentity` helper; the continuing payload carries `primarySessionId`; voice counts as a child of global for the presence dot. D2 voice status: `foldSessionChains` admits `scope: 'voice'`; the three unscoped-overview consumers filter it; the Voice chat menu row wears its own mark; the shell global light aggregates global ∪ voice; `useSessionStatuses` covers voice. D3 interrupt: `POST /root/turn/interrupt` takes optional owner-checked `sessionId` (global-or-voice chain), `use-chat-turn.interrupt` passes `activeSessionId`. D4 split `routes/root/index.ts` (voice-chat doors + interrupt out). D5 remove `/activity/running` + `listRunningTurns` consumer-less seed. D6 fix the stale load-bearing comments in owned files. Tests: store/composable suites (voice never binds to global; identity match; aggregate light), route tests (interrupt by id, owner check), overview fold test for voice. |
| **E · Voice daemon** | opus | `apps/voice/src/**`, `packages/voice/src/**` | E1 watchdog: after `VYNEL_VOICE_TURN_WATCHDOG_MS` busy the driver speaks "still working — I'll tell you when it's done" and returns to listening while the server turn continues (speak calls still route normally). E2 `streamTurnEvents` gets an `AbortController` tied to the watchdog + a connect deadline. E3 `onSpeak` handed-off branch routes by producer (the overlay's own turn is already de-duplicated client-side): publish to the overlay, else native — never a no-op. E4 `mapFrameToBrainEvent`: a recoverable `session-errored` is not `failed`. E5 call client sends `{ mode: VOICE_TIER_MODE, voice: true }` (+ the wake leg sends `voice: true` already). E6 daemon renders `turn-queued` as a short spoken "one moment". Tests: driver state machine (watchdog), brain client (abort, recoverable), call client body. |
| **F · Nodes structure + bugs** | opus | `apps/local-web/src/views/NodesView.vue`, `apps/local-web/src/components/nodes/**`, `apps/local-web/src/composables/nodes/**`, `apps/local-web/src/utils/constellation-*.ts`, NEW `packages/session/src/overview/list-session-children.ts`, the children route appended to `apps/local-api/src/routes/sessions/index.ts` (+ schemas), `packages/contracts/src/chat/session-children.ts` (new) | F1 bugs: project level uses a SCOPED overview read; `hasAnswered` wired at the fleet level; scene scratch buffers keyed by node id; count-aware layouts (rings / radius ÷ n) so ~9+ nodes stay on stage; `NodesRace` uses the real ladder label; arcs map the chain's whole segment set; `anchorOf` stops `findIndex`-ing per frame. F2 structure: `SceneNodeRef` discriminated union (`workspace | global | voice | session | agent-run | task`, minted + parsed in ONE place), a level STACK replacing the `isInsideProject` boolean, `SceneNode.detail` bag (note, elapsed, child count — rendered only in the tooltip), edges folded onto the live channel (should). F3 data: `GET /sessions/:id/children` (spawned sessions + agent runs + tasks by parent primary, from `session_turns.primarySessionId` + `delegation_jobs.threadId`), voice modelled as a child of global. NO visual change; screenshot parity before/after. |
| **G · Continuity durability + denominators** | fable | `packages/session/src/continuity/**`, `packages/session/src/runtime/{run-turn-with-continuations,apply-primary-turn-continuity,build-continuity-context,fit-pinned-model-to-session,with-boundary-continuity,bridge-primary-session-after-turn}.ts`, `packages/session/src/delegation/enqueue-checkpoint-continuation.ts`, `packages/session/src/mcp/checkpoint-tool.ts`, `packages/session/src/repositories/primary-sessions.ts`, `packages/chat/src/turn-consumption/{handle-usage-reported,handle-session-started}.ts`, `packages/chat/src/records/record-swap-segment-session.ts` | G1 durable checkpoints: `pending-checkpoints.ts` becomes DB-backed on the new `primary_sessions` columns (same API surface: begin/peek/take/depth/cap; the follow-up job id persisted so its claim counts); a restart mid-checkpoint resumes the continuation instead of silently dropping it; `beginGenuineTurn` still resets depth. G2 `enqueue-checkpoint-continuation` agent-run branch carries effort + origin. G3 `lastContextWindow`: written with every usage report, copied forward on swap (both homes), used as the pressure denominator + by the fit guard, with the fold's chain fallback when a fresh segment has none. G4 carry tail budgeting SKIPS an over-long line instead of breaking. G5 continuity census test (every `consumeSessionEventStream` production site is wrapped by `withBoundaryContinuity`, 5 ↔ 5). Tests for each. |

Shared rules for every slice: audit-mode discipline is over — this is real work: **every change ships its
tests**, targeted `npx vitest run --project node|local-web <files>` + `npx tsc --noEmit -p <pkg>` green
before hand-back; **never** `pnpm test`/turbo (Chad's CPU rule); regenerate SDK/catalog locally only to
validate (`pnpm api:generate`) — the LEAD regenerates once after the merge; conventional commits on the
slice branch, no `Co-Authored-By`; no source edits outside the ownership list (if a slice needs a line
in another owner's file, it writes the ask into `docs/module-notes/session-hardening.md` §6 and stops
there); comments explain WHY; files ≤ ~300 lines (split when a change would cross it).

## 4. Acceptance bar (what "solid" means)

- No unbounded wait anywhere a turn can park: every approval/ask/lock/turn has a bound and an owner.
- Single-writer invariant: one live turn per target key at all times, provable by a test.
- One identity vocabulary on the wire: `scopeKind ∈ {global, workspace, voice}` + `primarySessionId`
  on every `begin`; no reader infers identity from an absence.
- Voice: tier + auto on every leg, no card, no PATCH, own status mark, Stop reaches ITS thread.
- Settings: `input ?? row ?? DEFAULT('auto')` everywhere; children inherit; `autoBuildout` = autopilot.
- Continuity: survives a restart mid-checkpoint; the denominator survives a foreign model.
- Nodes: bug-free bindings, enlargeable in one composable per level, screen unchanged.
- The seams have tests (lock lifetime · call-leg tier · catch-up-not-consumed · voice-not-
  interruptible-by-global · continuity census · identity match).

## 5. Integration protocol (lead)

1. Wave 0 green + committed on `feature/session-audit`; slice worktrees `feature/sh-{a..g}` created
   from that commit, `pnpm install` each.
2. Agents work in parallel; each ends with `git status` clean, targeted checks green, a ≤40-line
   hand-back (commits, tests added, anything for §6).
3. Merge order **A → C → B → G → D → E → F** into `feature/session-audit` (`--no-ff`); after ALL merges
   the lead regenerates (`pnpm api:generate`), diffs the generated artifacts, runs the five parity
   guards, repo typecheck, and the vitest suites of every touched package/app.
4. `code-reviewer` on the integrated diff; fold must-fixes; then Kafi runs (or okays) the FULL gate.
5. STATE.md + CHANGELOG + this note's §7 (results); Kafi's live smokes: voice wake/call/panel, a >10-min
   delegated task, a restart mid-checkpoint, the Voice chat mark, Stop on both threads, Telegram auto.

## 6. Cross-slice asks (append here instead of editing another owner's file)

**From C (streams & bounds):**

- **A — `run-global-root-turn-core.ts:93`:** derive the lock key through the new
  `rootTurnLockKey(userId, isVoiceTurn)` (exported from `@vynel/session/runtime`, defined in
  `root-turn-lock.ts`) instead of the inline template — the stream asks `isRootTurnLockBusy` about
  the same key before it parks; one home for the shape.
- **A — `run-global-root-turn-core.ts:202` (`?? 'bypass-with-behavior-gate'`):** the SSE stream
  now ALWAYS passes a resolved `permissionMode` (`input ?? row ?? DEFAULT_SESSION_MODE`), so
  this fallback is unreachable from the web/voice path; A5's `?? DEFAULT` change covers the channel
  runner. C added the minimal `autoBuildout?: boolean` on `RunGlobalRootTurnCoreInput`
  (`session-types.ts`, unowned) — identical to A's planned addition; keep one.
- **B — `resolveTurnSessionSettings` (B1):** once it returns `autoBuildout`, collapse the one local
  read in `apps/local-api/src/streams/interactive-turn-settings.ts` (`input.autoBuildout ??
  row?.autoBuildout`) to `resolved.autoBuildout`. The streams already pass `autoBuildout` into
  `startChatTurn` / the core via an optional spread, so B's `StartChatTurnInput.autoBuildout` +
  A's core field light it up at merge with no further stream edit.
- **D — `apps/local-api/src/routes/root/index.test.ts`:** C corrected two expectations its stream
  changes invalidated (voice runs the tier: model `claude-sonnet-5` / effort `low` / mode `auto`;
  a fresh mode-less global turn runs `auto`, resolved by the stream). Same lines A's core-default
  change would have touched — resolve any merge conflict toward these values.
- **B (`use-session-settings` / VoiceChatPanel) — FYI:** the server now forces the tier on every
  `voice: true` turn (both `/root/turn` and `/sessions/:id/turn`) and ignores the body's
  mode/model/effort/autoBuildout — read-only chips are honest by construction.
- **E (`apps/voice`) — FYI:** `POST /sessions/:id/turn` accepts `voice: true` (Wave 0 field) and
  now enforces the tier on it; the call client should send it (E5). The daemon can also expect a
  `turn-queued { reason: 'busy' }` frame from `/root/turn` (E6) and a
  `session-errored { errorCode: 'turn-wall-clock-exceeded' }` frame when the interactive clock
  cuts a turn off.

**From B (settings & modes) — what B built, and the four lines it could not write.**

What landed, so the other slices can wire against it:

- `resolveTurnSessionSettings` now returns a **fourth** field, `autoBuildout`
  (`input ?? row ?? undefined`), and `TurnSettingsInput` carries it. `TurnSettingsWriteInput`
  is gone (it was `TurnSettingsInput & { autoBuildout }` — now redundant); the
  `@vynel/chat` barrel no longer exports that name.
- `startChatTurn` gained **`autoBuildout?: boolean`** on its input. True appends
  `loadSessionInstruction('autopilot-marker')` to the PROVIDER user message (after any
  `providerUserMessageText`); the persisted row keeps the clean text.
- `recordSpawnedSessionSegment` gained **`settings?: ChatSessionSettingsPatch`** (the birth
  write), forwarded from `createSpawnedSession`'s new **`settings?: ChatSessionSettingsPatch`**.
- `updateChatSessionSettings` throws **`ForbiddenError`** on a `voice`-scope row (empty patch
  included). The PATCH route declares 403; `packages/sdk` artifacts are regenerated.
- `AppComposer` / `ChatComposer` gained **`settingsLocked`** (+ `settingsLockedNote` on
  AppComposer); `useSessionSettings` takes `{ locked }` and its `update()` throws when set.

Asks:

1. **→ LEAD, post-merge — NOT slice C.** C's worktree branched from `25e86499`, where
   `startChatTurn` has no `autoBuildout` knob (B adds it), so this could not have typechecked
   in C's checkout and is in nobody's diff. After B merges, add to the `startChatTurn(...)`
   call in **`apps/local-api/src/streams/chat-turn.ts`** and **`.../session-turn.ts`**:
   `...(turnSettings.autoBuildout !== undefined ? { autoBuildout: turnSettings.autoBuildout } : {})`.
   Two lines, two files. **Until they land, D8 (autopilot) runs on the GLOBAL brain only** —
   A5 wired `input.autoBuildout` on the core; workspace/DM and spawned-session turns resolve
   the setting and drop it. (Channels + schedule fires resolve it nowhere — outside every
   slice's ownership; a follow-up, not a regression.)
2. **→ Slice C (streams).** B4's Voice-panel poll predicate is now `scopeKind === 'voice'` with
   **no `origin` fallback** — deliberately, since a global-scoped voice-origin turn is the bug
   this arc removes. It is dormant until C3 stamps `scopeKind: 'voice'` on the voice leg's
   `activityFeed.begin`. B's test constructs the feed entry synthetically, so nothing is red in
   the meantime; the live behaviour needs C.
3. **→ Slice D, or the lead if D has already handed back** (`apps/local-web/src/stores/ui-store.ts:121-124`).
   The `readStoredAutoBuildout` comment still says "NOTHING READS IT YET … waiting for the
   build engine". It is now autopilot (D8) and the runners read it — please restate.
4. **→ Whoever lands next in `packages/chat/src/schema/chat-sessions.ts:116-118`** (unowned).
   The `autoBuildout` column comment still says "nothing consumes it yet (the build engine is
   pending)". B left it rather than take a comment-only diff on a file it does not own.
5. **→ Lead, a scoping call.** The audit item is "**spawned / agent / leaf** sessions born with
   NULL settings". B2's mandate — and B2's fix — is the SPAWNED create handler.
   `packages/chat/src/records/record-leaf-session.ts` still births agent/leaf rows with NULL
   settings columns. Behaviour is nonetheless correct after A5 (a delegated/agent run resolves
   `job ?? target row ?? DEFAULT`), so this is a row-hygiene gap, not a live defect — but the
   audit item is two-thirds closed, not closed.

Files B touched OUTSIDE its list, all functionally (flagged for the merge): `packages/chat/src/index.ts`
(drop the dead `TurnSettingsWriteInput` export), `packages/chat/src/records/record-spawned-session-segment.ts`
(the birth write — pre-agreed), `packages/ui/src/components/ChatComposer.vue` (+ its test; the
`settingsLocked` prop — unowned by any slice), `packages/contracts/src/chat/voice-tier.ts` (B5's
doc rule at the tier home), `packages/sdk/{openapi.json,src/generated/api.d.ts}` (regenerated).

### From D (monitoring identity, voice status, interrupt, root routes)

**Deviation from §3 D2 — read this first.** The plan said "the fold admits voice; the three
UNSCOPED-overview consumers filter it out". That leaks: `GET /sessions/overview` unscoped **is**
`list_sessions`' answer (root + workspace-interactive surfaces), so an admitted voice entry would
hand every workspace manager the spoken thread's row — its title, its `statusNote`/`lastError` text
and its segment ids — and the route cannot tell a UI call from a tool call (a query flag would just
become a tool argument). So: the fold admits voice, and `getSessionsOverview` /
`countSessionsOverview` drop it unconditionally; `isSessionInScope` says the exclusion out loud;
the Voice chat surface reads `GET /root/voice-chat/status` → `getVoiceChatOverviewEntry`.
Consequence: **`LiveSessionPane.vue` and `SessionThreadView.vue` need no filter** — they resolve an
entry by session id out of a list a voice entry can no longer reach, so a filter there would be
unreachable code. `TasksPanel` did change, but at the TURN level (it counts running turns, not
entries) — voice is excluded there because the box names its rows from that same list.

**Wire assumptions D's readers make** (check against C at merge):

- Voice turns announce `scopeKind: 'voice'`; global turns announce
  `primarySessionId = <the global primary's id>` — the same value `GET /root/continuing` returns as
  `rootSessionId`. No continuing-payload field was added; `rootSessionId` already carried it.
- **Workspace turns stamp NO `primarySessionId`** (`chat-turn.ts:379`, and the workspace-root branch
  of `run-delegation-claim-and-run-tick.ts:322`). `matchTurnToIdentity({ kind: 'workspace' })` uses
  that absence to exclude sessions spawned in the room. See the ask to C below.
- Both swap writers carry `scope` forward (`record-swap-segment-session.ts:95`,
  `handle-session-started.ts:133`), so a voice chain's TAIL stays voice-scoped across a compaction
  swap — the fold branch, the list's voice wall and D3's interrupt gate all key on it. Pinned by a
  test.
- `getVoiceChatOverviewEntry` takes the newest voice chain (the fold sorts `lastMessageAt` desc).
  Correct while the partial-unique index keeps one live voice primary per user.

**Edits D made outside its ownership** (all forced by a contract change; each is one
mechanical line, declared so the lead can check them at merge):

1. `apps/local-api/src/routes/sessions/schemas.ts` — `SessionsOverviewEntrySchema` gains
   `primarySessionId: z.string().nullable()`. Without it the OpenAPI/SDK entry type drifts from
   `SessionsOverviewEntry` and the web client's assignment stops typechecking. **F rebases after D
   here** (F appends the children route's schemas to the same file — different location).
2. `apps/local-web/src/views/DesktopControlOverlayView.vue` — `root.interruptTurn()` →
   `root.interruptTurn({})` (the route now takes an optional JSON body). Behaviour-identical.
3. Entry test FIXTURES gained `primarySessionId: null`: `composables/chat/context-occupancy.test.ts`,
   `views/sessions-view.test.ts` (both outside D's list; the other three were D's own).

**Asks for other slices:**

- **C (or whoever owns the overlay's Stop gate):** `DesktopControlOverlayView.vue:114-121` decides
  `canStop` with `turn.primarySessionId === null` — "a root turn names no identity". Once C stamps
  `primarySessionId` on GLOBAL turns that is never true, so the overlay's Stop silently disables for
  the global root. It needs the identity comparison the rest of the app now uses (the overlay's
  tracked-turn fold carries no `sessionId`, so it also cannot use D3's `sessionId` body yet).
- **C:** `chat-turn.ts` still begins WITHOUT `primarySessionId`, and D's `{ kind: 'workspace' }`
  identity depends on that absence to exclude sessions spawned in the room. If workspace turns ever
  start stamping it, workspace binding silently stops working — change the predicate in the same move
  (`apps/local-web/src/composables/activity/match-turn-to-identity.ts`).
- **Unowned, low priority:** `listRunningSessionTurnsForUser`
  (`packages/session/src/repositories/session-turns.ts`, re-exported from `runtime/index.ts`) lost its
  only caller with `/activity/running` (D5). Its own repo tests still pass; left in place because
  `packages/session/src/repositories` is not D's.

## 7. Results

_(filled at integration)_
