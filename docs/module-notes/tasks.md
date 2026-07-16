# Tasks — module notes

**Status:** design agreed 2026-07-17 · net-new leaf (no old-repo code to move — this module is
*built*, not pulled, but it follows the same gates: shape → green → improve).
**Arc:** first of four (Tasks → Ask → Apps → SSH), Chad's feature round of 2026-07-17.

## Chad's advice (the why)

- The agent SDK gives Claude **no built-in task feature** — Vynel compensates. On multi-step work
  Claude creates tasks, marks them done as it completes them, and the user *sees* that happen.
- Tasks exist **per workspace AND globally** (the standard NULL-`workspaceId` scope model).
- The user can see everything Claude completed — per workspace and globally — **on the dashboard**.
- A **small right-side icon** opens a task-list panel (the SessionsPanel toggle pattern) so tasks
  are one click away while chatting.
- **Free tier** (basic) — no `featureGate`. Tasks are part of the core "one brain you can trust"
  experience, like chat and workspaces.

## Shape

### Leaf: `packages/tasks` (`@vynel/tasks`)

Template: `packages/schedules` (package.json/tsconfig shape, concern folders, barrel `index.ts`).

**Schema** — `schema/tasks.ts`, registered in `drizzle.sqlite.config.ts`, migration `0006_tasks`:

| column | notes |
|---|---|
| `id` | PK |
| `userId` | `id().references(users.id, cascade)` — tenant, non-null |
| `workspaceId` | nullable `text().references(workspaces.id, cascade)` — NULL = global |
| `title` | non-null |
| `detail` | nullable — the longer description |
| `status` | `'open' \| 'in-progress' \| 'done'` |
| `source` | `'assistant' \| 'user'` — who created it |
| `sessionId` | nullable loose `text()` ref (NO FK) — which chat session created it |
| `createdAt` / `updatedAt` / `completedAt` | `completedAt` nullable, stamped on → done |

**Repositories** — functional, sync, `db` first arg: `insertTask`, `findTaskById`,
`getTaskByIdOrThrow`, `updateTask`, `hardDeleteTask`, `listTasksForUser` (both scopes, status
filter), `listTasksForWorkspace`.

**Operations (as built)** — `lifecycle/` (`create-task`, `update-task`, `delete-task` — status
changes live INSIDE `update-task`, one home for the completion rule), `queries/` (`list-tasks` +
`list-tasks-for-user`). Every mutation co-commits its outbox event in one `withTransaction`:
`task.created` / `task.updated` / `task.completed` / `task.deleted` (`tasks-events.ts`). A
transition TO `done` stamps `completedAt` and emits `task.completed` (not `task.updated`);
leaving `done` clears it. Any → any transition is allowed (a user can reopen a done task).

### Routes: `apps/local-api/src/routes/tasks/` (as built)

Mirror `routes/schedules/`: `index.ts` (workspace-scoped, `/workspaces/:workspaceId/tasks`),
`user-scoped.ts` (`/tasks` — spans global + workspace rows), `schemas.ts`, `serializers.ts`.
No `featureGate`.

**The two-door provenance model:** the workspace-scoped surface is THE AGENT'S DOOR — its
`POST /` hard-codes `source: 'assistant'` (no body field to spoof) and carries the write tools;
the user-scoped surface is THE USER'S DOOR — its `POST /` hard-codes `source: 'user'` (the
panel/CLI path) and owns `DELETE`. Provenance is unspoofable by construction. The agent gets no
delete tool — reopening/completing covers its needs; removal is the user's call.

`x-sdk-name`: `tasks.*` (agent door) / `tasksUser.*` (user door). `x-mcp`:

| tool | route | mutating |
|---|---|---|
| `list_tasks` | GET workspace-scoped | no |
| `list_my_tasks` | GET user-scoped (both scopes) | no |
| `create_task` | POST workspace-scoped | yes (`mutatingApproved: true` — no card, see below) |
| `update_task` | PATCH workspace-scoped (title/detail/status) | yes (`mutatingApproved: true`) |
| `complete_task` | POST :id/complete workspace-scoped | yes (`mutatingApproved: true`) |

Task writes are **deliberately uncarded** (like memory/knowledge writes): low-stakes, fully
visible, trivially reversible in the UI. They are NOT added to any `mutatingToolNames`.

### Capability + prompt

- `tasks` entry in `CAPABILITY_CATALOG` (`defaultEnabled: true`) + `CapabilityId` union (+ the
  capabilities route enum).
- All five tools gated via `capabilityGatedTools` on `vynelWorkspaceDescriptor` — toggling Tasks
  off removes the tools AND the standing prompt line.
- **Contract change (additive):** `McpFeatureDescriptor.contributePrompt` gained an optional
  second arg `enabledCapabilityIds` — the composer's own prompt-skip is all-or-nothing per
  descriptor, and the multi-capability `vynel` descriptor needs to drop ONE capability's prompt
  section (the tasks discipline) while another capability's tools stay live. Single-capability
  descriptors (notebook, desktop) ignore it. Spec test added to the composer.
- Standing prompt (`TASKS_PROMPT_INSTRUCTIONS` in the vynel descriptor): check list_tasks first,
  one task per distinct piece of work in plain language, in-progress when starting, done when
  finished + verified, never narrate the bookkeeping.
- **Global root: NO task tools in v1.** The global root is a router (routing descriptor only);
  its work delegates down to workspaces where the tools live. Global (NULL-workspace) rows are
  created via the panel/CLI (`tasksUser.create`). Revisit if the global root ever needs its own
  list.

### UI: `apps/local-web`

1. **TasksSection** — registered in `workspace-sections.ts` + `WorkspaceSectionPanel.vue` +
   `SECTION_ICONS`; scope-aware like SchedulesSection (global rows show everywhere). Rows: status
   control (open ▸ in-progress ▸ done), title/detail, source chip (Claude/you), completed rows in
   a collapsed "Done" group. Add-task via a small inline composer (no dialog needed for v1).
   Beauty template: the Channels card pattern.
2. **Right-side panel + icon** — `TasksPanel.vue` following SessionsPanel: an `ui-store` flag
   (`isTasksPanelOpen`), a title-bar/status-bar icon with an open-count badge, rendered in the two
   chat views. Live-ish via vue-query invalidation on turn end + the standard refetch.
3. **Dashboard card** — `dashboard.getOverview` grows `openTasks` (+ a small recently-completed
   count); HomeView gets a Tasks card next to "Coming up".

### CLI + SDK

`pnpm api:generate` after routes; `apps/cli/src/tasks-commands.ts` (`vynel tasks list|add|done`)
registered in `index.ts`.

## Decisions taken

- **No approval cards on task writes** — visibility + reversibility is the safety story.
- **`in-progress` exists** — the panel's job is "what is Claude doing right now"; two statuses
  can't show that.
- **Hard delete** (no `deletedAt`) — matches schedules; a task is not irrecoverable user content.
- **No `priority`/`dueAt` in v1** — tasks with dates are Schedules' territory; don't blur the two.
  Revisit only on real user pull.

## Deferred (deliberate)

- Channels surfacing ("what's on my list?" over Telegram works already via the MCP tools; a
  formatted digest is later).
- Task→session deep-link in the panel (needs the unified right dock; `sessionId` is stored now so
  the link is data-ready).
- Subtasks/nesting — flat list until proven insufficient.

## Build order (gate-green at each step)

1. Leaf package + schema + migration 0006 + repos + ops + events + tests.
2. Routes + schemas/serializers + mounts + `api:generate` + route tests.
3. Capability entry + descriptor gating + prompt line + spec tests.
4. UI (section + panel + dashboard card) + component tests.
5. CLI commands + tests. → full gate → code-reviewer → prompt Chad to commit.
