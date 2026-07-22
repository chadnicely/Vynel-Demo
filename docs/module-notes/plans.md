# Plans — module notes

**Status:** requested by Chad 2026-07-23 ("create 2 new features like task — Plan and Journal") ·
net-new leaf, *built* (not pulled), same gates as Tasks: shape → green → improve.
**Arc:** Plans + Journal, built together on the Tasks template.

## Chad's advice (the why)

- Plans store the user's plans **date-wise with details** — "what is planned for this day", one
  level above the task list.
- **Tasks link to plans**: `tasks` grows a `planId` so a plan's work items are its tasks. The
  link is a **loose ref** (NO FK — `plans` and `tasks` are sibling leaves; cross-feature FKs are
  banned; a deleted plan leaves a dangling id harmlessly, like `sessionId`).
- Exposed through MCP so the assistant maintains plans the way it maintains tasks.

## Shape

### Leaf: `packages/plans` (`@vynel/plans`)

Template: `packages/tasks` byte-for-byte in structure (package.json/tsconfig shape, concern
folders, barrel, test-support).

**Schema** — `schema/plans.ts`, registered in `drizzle.sqlite.config.ts`, migration `0016_plans`:

| column | notes |
|---|---|
| `id` | PK |
| `userId` | `id().references(users.id, cascade)` — tenant, non-null |
| `workspaceId` | nullable `text().references(workspaces.id, cascade)` — NULL = global |
| `title` | non-null, ≤200 |
| `detail` | nullable, ≤4000 — the plan's details |
| `planDate` | non-null `text()` `YYYY-MM-DD` — THE date-wise key (a plan belongs to a day) |
| `status` | `'open' \| 'in-progress' \| 'done'` (the tasks status model — one vocabulary) |
| `source` | `'assistant' \| 'user'` |
| `sessionId` | nullable loose `text()` ref (NO FK) |
| `createdAt` / `updatedAt` / `completedAt` | `completedAt` stamped on → done, cleared on reopen |

Indexes: `(userId, workspaceId)`, `(userId, planDate)`, `(userId, status)`.

**`planDate` is a text day, not a timestamp** — "date-wise" is calendar semantics; a text
`YYYY-MM-DD` sorts correctly, is dialect-agnostic, and dodges timezone drift entirely. Validated
by one shared `PLAN_DATE_PATTERN` (core op + route schema mirror it).

**Same migration adds `tasks.plan_id`** (nullable text, additive ALTER — one logical move:
plans + the task linkage). Tasks' create/update ops + routes + serializer + contracts grow
optional `planId`; `list_tasks` gains an optional `planId` filter (a plan's checklist in one
call).

### Routes: `apps/local-api/src/routes/plans/`

Mirror `routes/tasks/` exactly — two-door provenance (agent door hard-codes
`source: 'assistant'`, user door `'user'`; unspoofable by construction), no `featureGate`,
writes uncarded (`mutatingApproved` — low-stakes, visible, reversible), agent gets NO delete.

| tool | route | mutating |
|---|---|---|
| `list_plans` | GET workspace-scoped (query: `status`, `planDate`) | no |
| `list_my_plans` | GET user-scoped (both scopes) | no |
| `create_plan` | POST workspace-scoped (`planDate` required) | `mutatingApproved` |
| `update_plan` | PATCH workspace-scoped (title/detail/status/planDate) | `mutatingApproved` |
| `complete_plan` | POST :id/complete workspace-scoped | `mutatingApproved` |

`x-sdk-name`: `plans.*` / `plansUser.*`.

### Capability + prompt

- `plans` in `CapabilityId` + `CAPABILITY_CATALOG` (`defaultEnabled: true`) + the capabilities
  route enum.
- All five tools in `VYNEL_CAPABILITY_GATED_TOOLS.plans`; a `PLANS_PROMPT_INSTRUCTIONS` section
  joins the workspace prompt when the capability is on (the tasks contributePrompt generalizes
  to per-capability sections).
- Global root: NO plan tools in v1 (router only — the tasks precedent).

## Decisions taken

- **Status model = the tasks vocabulary** (`open`/`in-progress`/`done`) — one status language
  across both lists; a plan "completes" the same way a task does.
- **`planDate` required** — a plan without a date isn't a plan here; undated work is a task.
- **Hard delete, user-door only** — same reasoning as tasks.
- **No plan→task cascade** — completing a plan does NOT touch its tasks (loose coupling both
  ways); the assistant closes tasks individually as it works.

### UI + CLI (built 2026-07-23, Chad's green light)

- **PlansSection** (`apps/local-web/src/components/sections/PlansSection.vue` + `PlanRow.vue`) —
  both scopes (workspace drawer + global menu), day-grouped newest-first with friendly labels
  (`utils/format-day-label.ts` — the client owns "today"), inline composer (title + date input
  defaulting to today), hover delete. **Reuses `TaskStatusControl`** (same status vocabulary by
  design; its `noun` prop keeps the accessible labels honest). Done plans stay dimmed in their
  day group — no cross-day archive fold (a plan is anchored to its day).
- Composables `composables/plans/*` (vue-query; invalidates its own key namespace — no Home
  card yet). Icons: `CalendarRange`.
- **CLI** `vynel plans list [-s|--date] | add [--date default-today|-w|-d] | done | reopen |
  move <id> <date> | delete` (`apps/cli/src/plans-commands.ts`; `day-flag.ts` = the date-flag
  home shared with journal).

## Deferred (deliberate)

- Dashboard card (open-plans count on Home) — ride the next dashboard touch.
- Date-range list queries (`from`/`to`) — exact-day + all is enough for v1.
- Plan progress rollups (n of m tasks done) + tasks nested under a plan row — needs a consumer
  first; the `planId` filter is data-ready.
- Calendar-validity check on day keys (regex admits `2026-13-40`) — a sweep across the pattern
  home + both route schemas when touched next.
