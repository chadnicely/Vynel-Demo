# Apps — module notes

**Status:** design agreed 2026-07-17 (Chad's fork answers below) · net-new leaf
(arc ③ of Tasks → Ask → Apps → SSH).

## Chad's advice (the why)

- Users get **easy access + monitoring for their apps** — a workspace has a monorepo with
  `api` and `web`; the user sees them and runs them; **Claude figures out the run command**.
- **Claude manages apps freely**: entering a new workspace and needing to run an app, it adds
  the app and runs it — **no permission, no approval card** (users can also start/stop from
  the UI). Running your own dev app is low-stakes and reversible; carding every `npm run dev`
  trains card-blindness.
- **Logs: live only** — an in-memory ring buffer (~2000 lines) per running app, streamed to
  the UI and readable by Claude. Nothing on disk; a restart starts fresh.
- **Discovery: Claude adds what it needs when it needs it** — no background scanner.
- **Pro tier** (with SSH), per the arc decisions.

## Shape

### Leaf: `packages/apps` (`@vynel/apps`)

**Schema** — `workspace_apps` (migration `0008_workspace_apps`). WORKSPACE-SCOPED v1 (an app
needs a cwd; the global scope has no directory — deliberate narrowing of the arc's
workspace|global default):

| column | notes |
|---|---|
| `id` / `userId` (tenant FK) / `workspaceId` (**NOT NULL** FK, cascade) | |
| `name` | e.g. "Web app" — plain language, unique per workspace (case-insensitive) |
| `command` | the shell command, e.g. `pnpm --filter web dev` |
| `cwdRelative` | subpath under `workspaces.path` ('' = root); **resolved + containment-checked** at spawn (no `..` escapes) |
| `port` | nullable — powers the UI's "open in browser" link |
| `createdAt` / `updatedAt` | |

No `source` column (unlike tasks): provenance isn't load-bearing here and would force a
two-door split for no user value. Outbox: `app.registered` / `app.updated` / `app.removed`
(DB changes) + `app.started` / `app.stopped` / `app.crashed` (runtime facts — publish-from-
day-one; the relay is live now).

**The process supervisor** — `running/app-process-supervisor.ts`, a stateful class (registry
exception), ONE per api process, DI'd like `askWaiters`:
- `start(app, workspacePath)` → `spawn(command, { cwd, shell: true })` (shell:true — the
  command is the user's/Claude's own dev command on their own machine; Windows needs the
  shell). Refuses a second start of the same app (Conflict).
- Tracks `{ appId → { pid, status: 'running'|'exited'|'crashed', startedAt, exitCode, ring } }`;
  ring buffer capped at 2000 lines (stdout+stderr merged, raw lines — no timestamps in v1).
- Settlement keys on `'close'` (fires on BOTH normal exit and spawn failure; `'exit'` never
  fires when spawn itself fails) with a settle-once guard — a phantom app can never read
  "running" forever, and stop() can never hang (review must-fix, 2026-07-17).
- `stop(appId)` → graceful kill; on win32 `taskkill /pid <pid> /T /F` (dev servers spawn
  children; a bare kill orphans them).
- `statusOf(appId)` / `logsOf(appId, tailLines)`; exited entries kept (with exit code) until
  the next start — "it crashed, here's why" survives the moment.
- `stopAll()` on shutdown (server.ts), so no orphaned dev servers after quitting Vynel.

### Routes: `apps/local-api/src/routes/workspace-apps/`

Mounted at `/workspaces/:workspaceId/apps`, **featureGate('apps')** (pro). One surface (no
user-scoped twin — apps are workspace things):

| route | x-sdk-name | x-mcp |
|---|---|---|
| GET / (rows + live supervisor status merged) | workspaceApps.list | `list_apps` |
| POST / | workspaceApps.add | `add_app` (mutatingApproved — uncarded) |
| PATCH /:appId | workspaceApps.update | `update_app` (mutatingApproved) |
| DELETE /:appId (stops it first) | workspaceApps.remove | — (removal is the user's call, the tasks precedent) |
| POST /:appId/start | workspaceApps.start | `start_app` (mutatingApproved — uncarded, Chad) |
| POST /:appId/stop | workspaceApps.stop | `stop_app` (mutatingApproved) |
| GET /:appId/logs?tail=200 | workspaceApps.logs | `get_app_logs` |

The UI polls list (3s while the section is open) + logs (2s while the log view is open) —
SSE streaming is a later nicety.

### Tier + prompt

- `apps` joins `HubFeatureKey` + `TIER_FEATURES.pro` (basic stays channels-only) +
  `featureGate('apps')` + `LockedFeatureCard` in the UI — the schedules pattern exactly.
- Standing prompt (rides the vynel descriptor's capability-aware contributePrompt? NO — apps
  isn't a capability; the tools are tier-gated at HTTP. The guidance goes in the tool
  descriptions ONLY, the schedules precedent): `add_app` teaches "inspect the workspace
  (package.json scripts, monorepo layout) to derive the right command; name apps in plain
  language; set the port if you know it"; `start_app`/`get_app_logs` teach the
  run-then-check-logs loop.

### UI: `AppsSection` (workspace sections, pro-locked)

Rows: status dot (gray stopped / green running / red crashed) · name + command (small
text-ink-3) · port link ("Open in browser" when running + port) · Start/Stop button ·
hover-reveal edit/remove · expandable log tail (monospace, auto-scroll, the poll). Add-app
via Modal dialog (name, command, folder, port).

### CLI

`vynel apps list|add|start|stop|logs -w <workspace>`.

## Decisions taken

- **No approval cards anywhere in Apps** (Chad). The safety story is visibility (status dots,
  the section, logs) + reversibility (Stop is right there) + the supervisor's containment
  (cwd must stay under the workspace path).
- **`shell: true` spawn is accepted**: the command is the user's own dev command on their own
  machine, same trust domain as Claude's existing Bash access in that workspace. The
  containment check guards the CWD, not the command.
- **Workspace-scoped only** (v1) — see schema note.
- **Supervisor state is process-local**: a daemon restart forgets running apps (they die with
  it via stopAll). No DB "running" column to go stale.

## Deferred (deliberate)

- SSE log streaming (poll first).
- Auto-restart / watch-crash-loop policies.
- Global-scope apps (absolute-path cwd).
- Port auto-detection from the app's output.

## Build order (gate-green at each step)

1. Leaf: schema + migration 0008 + repos + CRUD ops + events + supervisor + tests.
2. Entitlements key + routes + gate + SDK regen + route tests (fake supervisor injectable).
3. UI (AppsSection + dialog + locked card) + tests. 4. CLI. → gate → reviewer → commit.
