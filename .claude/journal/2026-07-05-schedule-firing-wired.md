# schedule firing wired — fire tick + fire-now (2026-07-05)

Finish-everything pass, task #13. Wires the ③ MCP keystone into a LIVE workspace turn so schedules
actually fire. Reordered ahead of channels (#11): the schedule fire uses the WORKSPACE turn path
(`startChatTurn` + `vynelWorkspaceDescriptor` + `composeSessionCapabilities`) — all built — whereas the
channel inbound-processing needs the global-root turn wrapper (a further piece). Runs in apps/local-api
as a boot service (NOT the worker): the turn needs the in-process MCP server from the api's own `app.request`.

## What landed
- **`run-schedule-claim-and-fire-tick`** ported → `packages/schedules/src/firing/` (was deferred). Atomic
  claim → `fireSchedule` each. One adaptation: `computeNextFireAt` guards `if (!cronExpression) return null`
  (KLONE's nullable one-time cron) — behind the `isOneTimeSchedule` short-circuit, behavior-neutral. Leaf
  stays pure (fires via injected `FireScheduleDeps`; no sibling-leaf runtime import).
- **`buildScheduleFireDeps(db, appRequest, logger)`** (apps/local-api/src/sessions) — async; dynamic-imports
  `vynelWorkspaceDescriptor` from `@vynel/mcp`, binds `composeWorkspaceMcpServers` (→ `composeSessionMcpServers`
  with the workspace's `enabledCapabilityIds`), `composeSessionCapabilities` + `startChatTurn` (`@vynel/session`).
  ONE documented cast reconciles the runtime `ChatTurnEvent` (Date) → the dep's wire type (fire reads only
  `session.id`/`textDelta`/`errorMessage`, present on both — runtime-safe).
- **`startSchedulesService`** (apps/local-api/src/services) — `setInterval(runScheduleClaimAndFireTick, 60s)`;
  started in `server.ts` after createApp, stopped on SIGINT/SIGTERM (fileWatcher precedent).
- **`POST /:scheduleId/fire-now`** on BOTH workspace + user-scoped route groups → `manualFireSchedule` (guards
  ownership by userId). NO x-mcp (a turn is never a tool). SDK `schedules.fireNow` + `schedulesUser.fireNow`.
- **Testability seam:** `scheduleFireDeps` injectable via `createApp` options (fileWatcher precedent) — prod
  builds the real deps; route tests inject a fake `startChatTurn` (fire + assert a run recorded, no live AI).

## Gate
- Full `pnpm test` **1548 passed / 4 skip**; typecheck 61; parity schema 30 · **MCP 16 (unchanged — no x-mcp
  leaked)** · SDK 47 paths / 56 methods. Reviewer CLEAN, no must-fix (cast runtime-safe + single; fire-now
  tenant-guarded + tested; testability seam real; tick faithful; boot wiring correct).
- **Boot smoke:** `tsx server.ts` → "schedules service started (poll 60s)" → "api listening" — the real
  MCP-binding chain resolves at boot, not just under fakes.

## Architecture note
apps/local-api → `@vynel/mcp` (`await import`) is the first such edge — by-design (architecture.md §6 routes
the descriptor into the turn composer; no static cycle — mcp re-enters the api over HTTP via appRequest).

## Committed backend-only (staged explicitly); Chad's parallel UI + pnpm-lock untouched. Next: channel ticks
(#11, needs the global-root turn wrapper) · CLI · cleanups.
