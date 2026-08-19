# Session system audit — round 2, five-agent synthesis (2026-08-19, post-hardening)

Main `71dbe151` (the session-hardening arc merged: `docs/module-notes/session-hardening.md`). Five
independent Opus agents re-ran the **identical eight-question brief** used in round 1
(`docs/audits/session-2026-08-19/`) with one addition — verify every round-1 P1 is closed in code —
from five different entry points (interactive streams · global+voice · delegation engine ·
continuity+settings · monitoring UI). Raw reports: `agent-1.md` … `agent-5.md` in this folder
(870–1000 lines each, line-cited). This synthesis keeps round 1 untouched.

**Legend.** `P1` major · `P2` minor · `P3` nit. `×N` = agents that found it independently. `REPRO` =
reproduced by a throwaway vitest (deleted after).

---

## Verdict — 8 / 10 (round 1: 7)

Agents: 7.5 · 8.5 · 8 · 8.5 · 8.5 (mean 8.2). The lead calibrates to **8**.

**What moved.** Every round-1 P1 is closed in code, most with a regression test that names its
incident: the delegation lock lives as long as the run (hard cap, lease, sweeper, CAS terminal
writes); the call leg runs the voice tier; voice stamps its own identity on the feed and the Global
chat can no longer bind to it; voice has a status; Stop is identity-shaped; the catch-up net is
consumed only once the turn is underway; the fit guard sits on every delegated pick; continuity is
census-guarded (5 ↔ 5); checkpoints are durable. Settings integrity (one resolver rule, birth-stamped
children, the tier forced on every voice leg) and continuity both rate 9 across the board.

**Why not 9 yet.** The arc changed two cross-cutting facts — `permissionMode`'s default and
`primarySessionId` on every global turn — and a default-config voice path, and swept only the readers
inside its slice map. Three regressions shipped (the working rail, the handed-off `speak` routing,
the daemon watchdog guarding the leg users don't run), two background paths never got a bound
(channel global turns, schedule fires — the arc's own bar says "no unbounded wait anywhere"), and
the restart-survivor semantics of the new durable checkpoint are incomplete in their likeliest
scenarios. All of it is local; none of it is architectural.

---

## Round-1 P1 closure (all five agents agree)

| Round-1 | Status | Evidence |
|---|---|---|
| L1 lock released under a live run | **CLOSED** | `route-request.ts` awaits the delegate; hard cap via cancel lever; `run-delegation-claim-and-run-tick.hard-cap.test.ts` pins two jobs never overlap |
| V1 call leg in `ask` | **CLOSED** | `session-turn.ts` + `interactive-turn-settings.ts` force the tier for `voice:true`; call client sends it |
| V2 voice impersonates global on the feed | **CLOSED** | `scopeKind:'voice'` + `primarySessionId` stamped; `matchTurnToIdentity` everywhere; repro tests permanent |
| V3 voice has no status | **CLOSED** | fold admits voice; `GET /root/voice-chat/status`; menu-row mark; global light aggregates |
| W1 unbounded card-less waits | **CLOSED on the user-facing half** — wall clock, ask bounds, daemon watchdog; **PARTIAL**: channel global turns + schedule fires still unbounded (see R2-A/R2-B) |
| G1 root lock wedged by a parked ask | **CLOSED on the interactive half** (ask bound + reaper + wall clock); **PARTIAL**: the channel runner holds the same lock with no clock |
| G2 catch-up marked before start | **CLOSED** | marked on the first `session-started`; repro test |
| V4 voice Stop reaches global | **CLOSED** | identity-shaped `POST /root/turn/interrupt`; voice surface never sends the empty body |
| M1 fit guard one caller | **CLOSED** | applied on delegated, agent-run and DM picks |

Round-1 P2s: 11 closed, 5 partial with named residuals (lock queues still unbounded; leaf rows NULL
by decision; `useMessageEdges` poll; agent-run origin), none untouched.

---

## Round-2 findings — ranked

### P1

| ID | ×N | Finding | Where | Minimal fix |
|---|---|---|---|---|
| **R2-A · Working rail regression** | ×4 (REPRO ×2) | `use-working-rail.ts:127-150` still branches on `primarySessionId != null` (pre-arc: "a spawned session"); the arc made it true for EVERY global/voice turn → the user's own global turn rails as a nameless "Working…" chip, Telegram loses its "Claude" chip, a voice turn's chip opens the spoken transcript / a 404. Its test pins a frame no producer can emit any more. | `apps/local-web/src/composables/activity/use-working-rail.ts:127-150`, `components/rail/WorkingRail.vue:33,57`, `use-working-rail.test.ts:52,54` | Route by identity (`matchTurnToIdentity`: global primary → brain chip, voice → voice chip opening the Voice chat surface, spawned → session chip); rewrite the test on the real wire; add a web-side identity census like `continuity-census.test.ts` over every `begin` producer. |
| **R2-B · Channel global turns have no wall clock / cap** | ×4 | The channel runner (`sessions/run-global-root-turn.ts`, driven by `channels-service.ts:90`) is the one `${userId}` root-lock holder with no bound — provider startup is the only clock. A wedged Telegram turn stalls web, deliveries and voice-free paths until restart. | `apps/local-api/src/sessions/run-global-root-turn.ts` (no clock), `services/channels-service.ts:90` | Wire `startTurnWallClock` (same helper as the three streams, `VYNEL_INTERACTIVE_TURN_MAX_MS`) into the channel runner, suspended on approval parks. |
| **R2-C · Schedule fires never got D3/D5/D8** | ×4 | `packages/schedules/src/firing/fire-schedule.ts:139` hard-codes `bypass-with-behavior-gate` (the floor still cards with nobody watching), resolves no model/effort/autopilot, takes no target lock and no bound; the tick awaits each due schedule serially so one parked card blocks the batch (`run-schedule-claim-and-fire-tick.ts:36,56-66`). The one D3 surface no slice owned. | `fire-schedule.ts:139`, `run-schedule-claim-and-fire-tick.ts:36,56-66` | Resolve `row ?? DEFAULT` (+ autopilot), wall clock, workspace target lock; fire due schedules concurrently (bounded). |
| **R2-D · Handed-off `speak` routing is wrong in both directions** | ×3 (REPRO ×1) | The E3 fold: the daemon now publishes during a handoff, but `overlay-channel.ts:229-241` delivers to the newest subscriber of ANY surface while the de-dup guard is per-window and session-lifetime (`isActive = state !== 'ended'`). Default config (Jarvis window + an app tab): the owner plays its own turn AND the app tab plays the relayed copy → **double-play**; meanwhile the owner window drops every relayed line for the whole overlay conversation (a schedule's line vanishes). | `apps/voice/src/overlay/overlay-channel.ts:229-241`, `apps/local-web/src/composables/voice/use-voice-daemon-link.ts:79`, `JarvisView.vue:30`, `use-voice-session.ts:76` | Make the relayed `speak` event carry the PRODUCING session id (the `/voice/speak` route has the ambient turn-session header); publish to the handoff-owning surface only; each window skips exactly the speaks whose session id is its own live turn's, plays all others. |
| **R2-E · Overlay close never stops the server turn; voice panel has no Stop for a daemon turn** | ×2 | No web client calls `root.interruptTurn` for the overlay (`voice-command-session.ts:159-166`): closing the overlay leaves the turn running and its reply speaks with no UI and no way to stop; the Voice chat panel renders no Stop for a daemon-driven turn (`VoiceChatPanel.vue:218,222`), and the guard would send nothing for an unknown session anyway. | `composables/voice/voice-command-session.ts:159-166`, `VoiceChatPanel.vue:218,222`, `use-chat-turn.ts:312` | Overlay end → `interruptTurn({ sessionId })` for its own resolved session; the panel renders Stop for a watched voice turn using the watched turn's session id. |
| **R2-F · Call-leg watchdog can drop the reply it promised** | ×3 | After hand-back, turn #1's late reply goes through `#speak` while turn #2 is speaking → `LineSpeaker` throws "already speaking" (`line-speaker.ts:52-55`) and the line is swallowed; hand-back can also start turn #2 under a speaking turn #1. | `apps/voice/src/call/call-conversation.ts:200-252`, `packages/voice/src/relay/line-speaker.ts:52-55` | Queue late replies through the speaker (await idle) instead of throwing; hand back only when not speaking. |
| **R2-G · Daemon watchdog guards the leg users don't run** | ×1 | With the default `VYNEL_VOICE_JARVIS_WINDOW=1` every wake hands off to the overlay; the watchdog is armed in `#runTurn` (the native fallback) — the overlay leg (web `use-voice-session`) has no bound at all. | `apps/voice/src/env.ts:85`, `main.ts:129,235`, `loop/voice-session-driver.ts:234-240`, `composables/voice/use-voice-session.ts` | A client-side turn watchdog on the overlay leg (same shape, same knob) — or arm the daemon's watchdog on the handoff too. |
| **R2-H · Restart-survivor checkpoint semantics incomplete** | ×4 (REPRO ×3) | The durable slot is single: (a) a survivor is never resumed on boot or shown in the UI — it waits for the next user message invisibly; (b) the next turn's `checkpoint()` overwrites the survivor silently (no note) — loss, not supersession, and the model never saw it (only a swap carry surfaces it); (c) on the voice thread (always `autoContinue:false`) a survivor is never continued, never dropped, never mentioned; (d) a handed-over slot leaks when its follow-up job settles by anything but its own claim (sweeper, stop). | `continuity/pending-checkpoints.ts:74-87,157-179`, `runtime/run-turn-with-continuations.ts:80-124`, `streams/global-root-turn.ts:444-446`, `delegation-orphan-settlement.ts` | Surface the survivor into the NEXT turn's provider input (a marker line) and into `whoami`; overwrite → `dropPendingCheckpoint` with a note; voice/delivery survivors get the note on their thread; clear the hand-over slot from every terminal settle of the job (sweeper + stop + cap). |

### P2

| ID | ×N | Finding | Where |
|---|---|---|---|
| R2-I | ×2 | **Decision for Kafi:** the `auto` default moved desktop plan authority to *standing consent* for every never-configured turn (`desktop-plan-consent.ts:12-25` treats `auto` as consent; `resolve-background-turn-settings.ts:69-73`, `run-task-job.ts:275`) — the 08-11 ruling stands, its premise changed. Keep (auto means auto) or require an explicit Auto pick for desktop ACTING. | `packages/desktop-control/.../desktop-plan-consent.ts` |
| R2-J | ×3 | Lock queues still unbounded + uncancellable; the wall clock arms only after acquisition → worst case N × 60 min; `turn-queued` fires once; a disconnected waiter still takes the lock. | `session-target-locks.ts:28-35`, `root-turn-lock.ts:41-57`, `chat-turn.ts:550` |
| R2-K | ×1 | An unbound agent-run (and a schedule fire) announces as the ROOM's own thread (workspace scope, no primary) → a pre-bridge workspace chat binds to it — round-1's V2 class through a new producer; no test pins any producer's `begin` payload. | `run-agent-run-job.ts:120-128`, `composer-mention-turn.ts:147-156,187`, `use-continuing-conversation.ts:60-64` |
| R2-L | ×1 | Laptop suspend > lease: the 60 s sweeper reaps live runs on wake (false "interrupted" for work kinds; a second notify turn for message kinds). CAS prevents corruption. | `delegation-service.ts:133-139`, `delegation-jobs-recovery.ts:37-45` |
| R2-M | ×1 | `listSessionChainSegmentIds` reads a 500-row window → past it a chain answers as one segment (truncates `segmentSessionIds` + children reads); two chain-walk homes disagree on a forked chain. | `overview/list-session-children.ts:166-184`, `chat-sessions.ts:145-151` |
| R2-N | ×1 | The checkpoint tool tells every turn "Vynel will continue you automatically"; voice, delivery and note turns never do — on voice the user hears the promise, then silence. | `mcp/session-mcp-feature-descriptor.ts:27-33,64`, `mcp/checkpoint-tool.ts:66-72` |
| R2-O | ×1 | Native voice leg has no "the model never called `speak`" net (the overlay leg does) — a decayed directive answers with silence. | `voice-session-driver.ts:291-309` vs `voice-turn-adapter.ts:29-35` |
| R2-P | ×1 | CAS is on status, not claim identity — a dead run's late requeue on a pending row burns an attempt. | `delegation-jobs.ts:349-375`, `classify-turn-failure.ts:58-66` |
| R2-Q | ×1 | `mutatingToolNames` ("always card") is inert on every default session — a consequence of D1/D3 worth recording as policy. | `tool-approval-policy.ts:103-113` |
| R2-R | ×1 | Project message arcs can never land on a spawned session (server sends a primary id, client maps segment ids). | `list-recent-message-edges.ts:76` vs `use-project-nodes.ts:157-160` |
| R2-S | ×1 | No Stop route for a spawned-session DM turn (client abort only; the server turn runs to the 60-min clock). | `use-session-turn.ts:37-42`, `interrupt.ts:34` |
| R2-T | ×1 | TasksPanel binds a session off the global FAMILY by insertion order; the shell light loses `problem` past the 50-row overview cap. | `TasksPanel.vue`, `use-session-statuses.ts` |
| R2-U | ×1 | The hard-cap suite is flaky (2 failures in 4 runs — unhandled rejection from `run-task-job.ts:408`). | `run-delegation-claim-and-run-tick.hard-cap.test.ts` |
| R2-V | ×1 | `failTurnOnWallClock` returns early when the session id is not known yet — no interrupt, provider runs on, lock held. | `turn-wall-clock.ts:125` |

P3s (recorded in the raw reports): `interruptTurn` answers `interrupted:true` unconditionally; `ApprovalWaitGate.onParkedChange` overwrites its single subscriber; the Global chat polls its transcript while only voice runs; `listRunningSessionTurnsForUser` dead; the children route + voice/global `SceneNodeRef` kinds have no renderer (by D7); the workspace-identity invariant (`primarySessionId` absent on workspace turns) has no server-side test; the global/voice read lift is tested in one direction only; global + voice still share one cwd for concurrent seeded swaps (named live smoke).

---

## The questions, answered (consensus)

1. **Bugs:** no P0; the P1s are the three arc regressions (R2-A/D/G), the two unbounded background paths (R2-B/C), the overlay/panel Stop gap (R2-E), the call reply drop (R2-F) and the survivor semantics (R2-H). Wall, ownership, outbox co-commits, restart reaps: clean.
2. **Stuck points:** bounded everywhere a user turn runs; still unbounded: channel global turns, schedule fires, every lock QUEUE (waiters), a spawned DM with no Stop route; the sweeper vs suspend edge.
3. **Settings:** one rule, one resolver per family, birth-stamping, tier forced on every voice leg, autopilot on every runner EXCEPT schedule fires; the desktop standing-consent shift is the decision to take.
4. **Missed improvements:** a web-side identity census (every `begin` producer × every reader), a producer-payload test, lock-queue bounds, the suspend-aware sweeper, one chain-walk home.
5. **Monitoring/nodes:** identity matching is now one home and honest; the rail is the one reader the arc forgot; Nodes is enlargeable (level stack, typed refs, scoped read, children route) with no new visuals by decision; arcs still miss spawned sessions (R2-R); no voice/global node yet (D7).
6. **Continuity:** census-guarded coverage; the durable register is correct on the happy path and lossy on survivors (R2-H); denominator fixed; carry fine.
7. **Score:** 8/10 — +1 = the eight P1 fixes (each ≤ ½ day); +2 = lock-queue bounds + producer/reader census + survivor UX.
8. **Voice:** tier + auto + no ask + own identity + own status + identity Stop + watchdog are real; no server-side double-speak; the daemon/overlay seam is where the three regressions live (R2-D/E/G) plus the call reply drop (R2-F). Open forks: `direct_to_user` to voice — after R2-D; voice-fired tasks on global — leave; **per-call routing toolset — prerequisite met, go after R2-F**.

## Recommended next slice (ordered)

R2-A rail → R2-D speak routing (session-id-tagged relay) → R2-E overlay/panel Stop → R2-B channel wall clock → R2-C schedules (settings + bound + concurrent tick) → R2-F call speaker queue → R2-G overlay-leg watchdog → R2-H survivor UX → R2-I decision → the P2 list.
