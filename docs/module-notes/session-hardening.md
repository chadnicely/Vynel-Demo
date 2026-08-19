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

### E → B (or the lead): the overlay must ignore relayed `speak` while its OWN turn is live

**Ships with E3, or E3 must be reverted.** E3's brief says "the overlay's OWN turn already
de-duplicates client-side (`voice-turn-adapter`)". It does not — I checked the code:

- `use-voice-daemon-link.ts:70-73` plays EVERY relayed `speak` event through its own
  `createSpokenAudioPlayer()`, unconditionally. Its own header (`:21-26`) states the contract it was
  built to: "a `speak` tool call with **no live overlay session** … is sent to exactly one client".
- `use-voice-session.ts:96` plays the overlay's own turn's `speak` calls through a SECOND, separate
  player (the adapter's `spoke` events). `voice-turn-adapter`'s `spoke` flag de-dupes its own gist
  fallback against its own `speak` calls — it never sees daemon-relayed ones.
- Both composables are mounted together (`JarvisView.vue:26-27`, `VoiceOverlay.vue:20-21`).

So the daemon publishing during a handoff double-plays the overlay's own turn — which is exactly what
the old no-op branch was defending against (native `driver.speak` double-plays too: browser speaker +
daemon speaker on one machine). The daemon cannot route by producer on its own: `/speak` carries only
`{ text, callId? }`, and a server-side discriminator can't help either — the overlay leg, the daemon
wake leg and the Voice-chat panel leg are all `voice`-scope global turns.

E ships the daemon half (`main.ts` `onSpeak` publishes to the overlay when handed off, native
fallback when the client is gone, honest logs). **The web guard is the other half:**
`useVoiceDaemonLink` takes a predicate (e.g. `isOwnTurnLive`) and drops relayed `speak` events while
the overlay's own command session has a turn in flight; the Jarvis/overlay views pass
`voice.isActive`. Net effect vs today: a schedule / panel / delivery `speak` during an overlay
conversation is *played* instead of silently dropped; only one landing inside the overlay's own live
turn is still dropped (today ALL are).

### E → C (informational, no action): `mode` on the call leg

`runCallTurn` now sends `mode: VOICE_TIER_MODE` + `voice: true`. Both `StartSessionTurnRequestSchema`
and `StartChatTurnRequestSchema` already accept `mode`, so C's `input.voice` gate simply overrides it
— the daemon sends it as belt-and-braces, not as the enforcement.

## 7. Results

_(filled at integration)_
