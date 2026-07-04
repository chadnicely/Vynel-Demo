# schedules vertical-slice + decouple — `@vynel/schedules` (2026-07-04)

Chad's priority feature #2 + the last big leaf. Same recipe as channels (inject cross-leaf runtime,
defer poll-tick). **Both KINDS come along faithfully** — no schema change needed for one-time/recurring.

## KEY: both kinds already exist in the source
`createSchedule` accepts `fireAt` (ONE-TIME → `ONE_TIME_CRON_SENTINEL` + `nextScheduledFireAt=fireAt`,
fires once then disarms) OR `cronExpression` (RECURRING via croner). The contracts (`schedules/one-time.ts`)
deliberately use a sentinel instead of a `scheduleKind` column (documented schema-migration-risk reasoning).
So Chad's "2 kinds (repeat, one-time)" = a FAITHFUL PULL; the external create shape (fireAt vs cron) is
exactly "targetable one-time or recurring". Explicit `scheduleKind` column = a deferred legibility improve.

## What landed
New leaf `@vynel/schedules` owning schedules + schedule-runs schema+repos + logic, folded:
`lifecycle/` (create/update/delete/set-enabled) · `firing/` (fire-schedule, manual-fire-schedule) ·
`queries/` · `rendering/` · events/types/extract-error-message/test-support at root.

## Decoupling (behavior-preserving)
- **`startChatTurn`** (fire-schedule) → INJECTED via `FireScheduleDeps` (structural, like the pre-existing
  `composeWorkspaceMcpServers`). Test `vi.mock('@vynel/core/chat')` → fake via deps; assertions byte-identical.
- **`ChatTurnEvent`** → `@vynel/contracts/chat/chat-http` (fields verified present; no Date/string bug).
- **HUB READS → kernel repos** (advisor-mandated): `getWorkspaceById` (owner-checked, throws) reproduced as
  kernel `findWorkspaceById` + inline `!ws || ws.userId !== userId → NotFoundError` — reviewer confirmed
  BYTE-IDENTICAL, owner-check intact (no tenant-isolation defect). `findUserById`/`findWorkspaceById` in
  render → kernel repos (pure pass-through). NOT rewired to `@vynel/workspaces` (would be leaf→leaf).
- **Deferred** (orchestration/channels precedent): `run-schedule-claim-and-fire-tick` (worker-cron poll) +
  `schedule-channel-delivery.integration.test` (cross-feature — app-layer composition).

## Gate
- drizzle **"No schema changes"**; full gate **1412 passed / 4 skip**; typecheck 54/54; parity 30; zero
  sibling-leaf runtime import. Reviewer CLEAN, zero must-fix.

## Still owed
workspaceId-nullable scope improve (same as channels) + schedules CRUD API (exposes fireAt one-time +
cronExpression recurring). Deferred improve: explicit `scheduleKind` column (the window is open now —
zero-data baseline-fold — Chad's call).
