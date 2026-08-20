# Schedule gaps — a missed slot speaks, a verbatim reminder lands in chat (2026-08-21)

Kafi's "do them" on the two gaps `.claude/docs/schedules/overview.md` names. Branch
`feature/schedule-gaps` (band 18940). Agents do NOT commit — the lead commits.

## G1 — a missed slot is silent
- `run-schedule-claim-and-fire-tick.ts` co-commits the `missed` run row **and** a new
  `schedule.run-missed` event in ONE `withTransaction` (invariant #5). Local times formatted
  producer-side (`formatScheduledTime`); "next run" = the claim's freshly computed slot, never the
  `nextScheduledFireAt` the claim just advanced past.
- One home for the words: `composeMissedScheduleNotice` in `@vynel/contracts/schedules`, beside
  `scheduleSourceLabel`; both legs read it.
- Chat leg: `consumeScheduleRunMissedEvent` in `@vynel/orchestration`, mirroring the run-failed
  consumer, scope-branched like `consumeTaskCreatedEvent` (workspace primary / global root).
  **Deviation:** a `report-delivery`, NOT a direct `recordNoteOnPrimaryHead` — `packages/session`
  owns `primary_sessions` and sits ABOVE the spine, so `core → session` is an upward import *and* a
  cycle. The lead's stated fallback.
- Channel leg: `enqueueMissedScheduleChannelNotice` in `@vynel/channels`; the `schedule.run-missed`
  registry entry calls both — one event, two reactions, the registry's only composite.

## G2 — a verbatim reminder's chat leg
- New REQUIRED `FireScheduleDeps.recordScheduleChatNotice` (sync — it runs INSIDE the terminal tx),
  bound in `build-schedule-fire-deps.ts` to `findPrimaryConversation` + `recordNoteOnPrimaryHead`.
  Verbatim branch only; run row + run-completed event unchanged.
- `recordSystemNoteMessage` / `recordNoteOnPrimaryHead` gain an optional `sourceLabel` → the row is
  `sourceKind:'system'` + "Schedule · \<name\>" (the global fire's precedent); body stays verbatim.
- **Known limit:** a scope with no conversation yet answers `'no-thread'` — a first-ever verbatim
  fire still lands nowhere, warn-logged (minting a session is out of scope).
