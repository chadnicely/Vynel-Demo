# Background turns — schedules run under the locked session rules, channels are bounded, the rail reads identity (2026-08-20)

Kafi's go (2026-08-20) on the remaining round-2 P1s R2-A / R2-B / R2-C (`docs/audits/session-2026-08-19-r2/README.md`)
plus his report "the schedule feature doesn't work now". Branch `feature/background-turns`
(worktree `.claude/worktrees/voice-routing`, band 18950).

## What is wrong today

- **Global schedules cannot run.** `fire-schedule.ts:95-110`: a GLOBAL schedule (workspaceId null) whose template is
  not verbatim (every `custom` schedule) throws `NotFoundError('workspace')` → the run is marked failed
  "workspace not found." — the dev DB shows exactly that (`b8c7f7f6…`, template custom, workspace null). The UI
  happily creates them (`CreateScheduleDialog.vue:153` scope global). The leaf says "a non-verbatim global turn would
  need the global-root machinery this leaf does not run" — but the machinery is injectable like everything else
  the leaf already gets through `FireScheduleDeps`.
- **R2-C:** workspace schedule fires hard-code `permissionMode: 'bypass-with-behavior-gate'` (`fire-schedule.ts:139`),
  resolve no model / effort / autopilot, take no workspace target lock, have no wall clock; the tick awaits each due
  schedule serially (`run-schedule-claim-and-fire-tick.ts:36,56-66`).
- **R2-B:** the channel global-root runner (`apps/local-api/src/services/channels-service.ts:90` →
  `sessions/run-global-root-turn.ts`) is the one `rootTurnLockKey(userId)` holder with no bound.
- **R2-A:** `apps/local-web/src/composables/activity/use-working-rail.ts:127-150` branches on
  `primarySessionId != null` — universal since the hardening arc — so the user's own global turn rails as a nameless
  "Working…" chip, Telegram loses its "Claude" chip, a voice turn's chip opens the wrong surface.

## Decisions (lead, under Kafi's locked D1–D8)

| # | Decision |
|---|---|
| BT1 | **A global schedule fires as a GLOBAL ROOT turn.** New `FireScheduleDeps.startGlobalRootTurn` bound api-side to the same runner channels use (`run-global-root-turn.ts`), with the rendered prompt as the user message, `scopeKind: 'global'` identity on the feed, the schedule's run row bound to the produced chat session id, the report/delivery path unchanged. Verbatim reminders stay verbatim. The fired global turn gets no `askWaiters` and no `desktopReader` — it is ask-free and desktop-blind, which is intended for now (nobody is there to answer a form; desktop tools on an unattended fire are a separate decision). |
| BT2 | **Settings = `target row ?? DEFAULT`** (D5 shape, no tool arg here): mode `DEFAULT_SESSION_MODE` (auto), model/effort from the target primary row (workspace primary / global primary) else the defaults — read off the row UNCLAMPED (review fold): a fire starts a FRESH session (D3), so the head's occupancy never rides it and the delegated fit clamp would only swap the user's pick for nothing; autopilot marker rides like delegated turns (D8). The hard-coded `bypass-with-behavior-gate` goes. |
| BT3 | **Bounds + lock:** every schedule fire runs under the delegated cap (`VYNEL_DELEGATED_TURN_MAX_MS` — same knob as delegated jobs; suspended while a card is parked) and takes the workspace target lock (`SessionTargetLocks`, the same key a delegated job takes on that workspace primary) — global ones take the root-turn lock through the global runner like channels do. The tick fires due schedules **concurrently through ONE process-wide `ScheduleFirePool` (bound `VYNEL_MAX_CONCURRENT_DELEGATIONS`, owned by the poll service, shared by every tick — review fold)**, so one parked card never blocks the batch and overlapping ticks never stack past the bound; a slot is CAS-claimed by the worker right before its fire (never up front for the batch), so a kill mid-batch loses nothing still waiting; one fire per schedule in the pool at a time. |
| BT4 | **Channel runner:** `startTurnWallClock` (the streams' helper, `VYNEL_INTERACTIVE_TURN_MAX_MS`) wraps the channel global-root turn, suspended on approval parks, failing the turn with the same typed error the streams emit. |
| BT5 | **Rail by identity:** `use-working-rail.ts` routes by `matchTurnToIdentity` (global primary → brain chip; voice → voice chip opening the Voice chat surface; spawned → session chip); the test is rewritten on the real wire + a web-side identity census over every `begin` producer. |

## Ownership (one worktree, disjoint paths, agents do NOT commit — the lead commits)

- **A schedules (fable):** `packages/schedules/src/**`, `apps/local-api/src/sessions/build-schedule-fire-deps.ts`, `apps/local-api/src/services/schedules-service.ts`, `apps/local-api/src/routes/schedules/**` (only if a response needs the global case), tests. BT1–BT3.
- **B channels (fable):** `apps/local-api/src/services/channels-service.ts`, `apps/local-api/src/sessions/run-global-root-turn.ts` (the bound only — A consumes this runner through a dep, so keep its signature stable; if you must add an option, make it optional), the channel consumer under `packages/channels` only if the bound must surface there, tests. BT4.
- **C rail (fable):** `apps/local-web/src/composables/activity/**`, `apps/local-web/src/components/rail/**`, tests. BT5.

## Acceptance

- A global custom schedule fires, runs a global-root turn, its run row completes with a chat session id, the report shows up where the other schedule reports do; a workspace schedule runs under auto + the row's model/effort, is bounded, holds the workspace lock; two due schedules fire concurrently; a schedule past the cap fails cleanly with the cap error.
- A Telegram turn past the interactive cap ends with the streams' wall-clock error and releases the root lock.
- The rail shows the brain chip for the user's global turn, "Claude" for Telegram, the voice chip for voice, a named session chip for spawned.
