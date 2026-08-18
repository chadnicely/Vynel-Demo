# Task execution — tasks become the unit of work Claude completes (module notes)

**Status:** design draft 2026-08-18 (Kafi's ask) — **awaiting okay before any code.**
**Builds on:** `tasks.md` · `plans.md` · `session-todos.md` · `ask.md` · `instructions-notebook.md`.

## Kafi's advice (the why)

Today tasks are mostly Claude's self-bookkeeping ("what is it doing / what has it done"). The new
model: **the user creates a task and Claude completes it** — tasks become the workspace's work
queue, not just its visibility layer.

- **User creates a task** — title required, description optional, attachments optional (details
  the user wants to hand over).
- **Claude is notified** on creation. Idle → picks it up instantly; busy → finishes the running
  work, then takes tasks **one at a time, in order**.
- **Clearance before work** when needed: short, smart, concrete — show what's needed OR what the
  user is going to get, with examples, in a view the user can decide from easily. Never
  half-context questions. If nothing is ambiguous, no clearance round at all.
- **Sizing fork:** simple task (2–3 files, no risk) → straight to steps. Medium/big → a
  long-lasting **plan → steps → execute**.
- **The plan and the steps link to the task** — inversion of today's task→plan direction. Claude
  rewrites the task's title/detail to standard when the user's wording needs it (and the user
  asked for a rewrite).
- **Steps are stored against the task** and shown on the task panel — not just the transient
  session dock.
- **Task panel becomes the work surface:** rows with an expander showing steps + `n/m` progress,
  an icon opening plan / description / connected session; a header with workspace activity
  (tasks completed/total, sessions working); a sessions box (count, expand → this workspace's
  working sessions — always workspace-filtered); **the panel opens by default**.
- **DB carries task→session assignment now.** Today the workspace manager (primary session)
  handles everything; the future feature is the workspace *feeding* tasks to sessions — the
  column lands now so that needs no migration.

## What exists (build on, don't duplicate)

- `tasks` + `plans` leaves — two-door provenance, uncarded writes, `open|in-progress|done`.
- `session_todos` — the per-session dock, whole-list replace, ambient `x-vynel-turn-session`
  header (the server-stamped identity pattern to reuse for pickup).
- **Ask** (`ask_user`) — the blocking wizard; this IS the clearance mechanism, already built.
- Outbox events (`task.created` …) + session-comms delivery + queued messages — the raw
  material for the notification seam.
- `TasksPanel.vue` — already the "work rail" (queue/done pills, live card, interrupt); this arc
  grows it rather than replacing it.
- Notebook `packages/instructions/notebooks/task-planner.md` — the direction document Claude
  reads; rewritten in this arc (modeled on Kafi's `/architect` skill).

## Shape (proposed)

### 1 · Schema (additive, drizzle-generated — never hand-written)

**New sibling table `task_steps`** in `@vynel/tasks` (the work-tracking leaf owns it). **Kafi's
clearance (2026-08-18): a step row carries the FULL linkage — `workspaceId`, `sessionId`,
`taskId`, `planId` — "not like the old one"** (the session-only dock shape):
`id · userId · workspaceId (nullable) · taskId (NOT NULL, same-leaf FK cascade — steps die with
their task) · planId (nullable loose ref — the plan the steps derive from; NULL on simple tasks)
· sessionId (nullable loose ref — the session that wrote the steps, server-stamped, never
model-supplied) · title · status open|in-progress|done · orderIndex · completedAt ·
createdAt/updatedAt`.
Whole-list replace **per task** (`replaceTaskSteps`) — the session-todos semantics, keyed by
task instead of session. `session_todos` stays untouched: the dock answers "what is this
session doing right now"; task steps are the task's durable plan-of-record. Two tables, two
questions, no blur.

**`tasks` grows:**
- `assignedSessionId` — nullable loose ref, the session *working* the task. Distinct from the
  existing `sessionId` (which records the *creating* session). Server-stamped from the turn
  session header when Claude picks a task up — never model-supplied (the set_todos identity
  rule).

**`plans` grows `taskId`** — nullable loose ref: the execution plan OF a task. This inverts the
relation for the execution flow (fork ① below decides what happens to `tasks.planId`).

### 2 · Tools (the agent door)

| tool | change |
|---|---|
| `set_task_steps` | NEW — whole-list replace of one task's steps (`taskId` + ordered titles/statuses). Uncarded like all task writes. |
| `list_tasks` | grows a steps rollup (`stepsDone`/`stepsTotal`) so one call paints the queue. |
| `create_plan` / `update_plan` | gain optional `taskId`. |
| `update_task` | unchanged — already covers the standard-rewrite (title/detail) and status. Pickup = status→`in-progress`; the route stamps `assignedSessionId` from the ambient header on that transition. |
| clearance | NO new tool — `ask_user` is the clearance surface. `ask_requests` gains a nullable loose `taskId` so the panel can show "waiting on you" against the task row. |

### 3 · The pickup loop (notification seam)

Outbox `task.created` with `source: 'user'` → **nudge the scope's primary session** (the
workspace manager) through the existing session-comms delivery: a system-authored note-shaped
message ("New task on the list: …"). If a turn is running, it lands as a queued message —
pickup happens naturally at turn end. One-at-a-time and in-order are **notebook discipline,
not machinery** — the nudge only wakes; the notebook tells Claude how to drain the queue.
No polling loop, no scheduler row.

### 4 · UI — TasksPanel rework (default-open)

- **Header — workspace activity:** tasks completed/total for the scope + sessions-working
  count.
- **Sessions box:** the count as the collapsed face; expand → this workspace's working
  sessions (reuse the sessions-panel composables, always workspace-filtered — the existing
  chip's rule, now listed in the panel).
- **Task rows:** expander (`->`) → the task's steps with live statuses + `n/m` progress;
  row icon opens plan / description / connected (assigned) session — TaskViewDialog grows
  these, resolving rows LIVE from the list query (the PlanViewDialog PIN).
- **Default open:** the panel starts open (ui-store default flips; the toggle still works).

### 5 · Notebook rewrite — `task-planner.md`

Rewritten on the `/architect` skill's spine (phases, hard rules, sanity checks), teaching the
full loop:

1. **Pickup discipline** — the queue is drained one task at a time, in order; one task
   in-progress ever; `assignedSessionId` rides the pickup.
2. **Clearance protocol** — decide if clearance is needed (missing decision, ambiguous outcome,
   risk). If yes: ONE `ask_user` wizard, concrete options with examples of what the user will
   get — never a vague "any preferences?". If no: proceed silently.
3. **Standard rewrite** — when asked, tighten the task's title to an outcome and the detail to
   the agreed scope *before* working, so the panel reads honestly.
4. **Sizing fork** — simple (one sitting, 2–3 files, no risk): `set_task_steps` and go.
   Medium/big: `create_plan` (with `taskId`) carrying goal/parts/approach/risks → then
   `set_task_steps` from the plan → execute.
5. **Execution honesty** — tick steps as they complete (re-issue `set_task_steps`), complete
   the task only when verified, report outcomes between tasks, then take the next task.
6. **Chat-origin work — same style (Kafi's clearance 2026-08-18).** The panel is not the only
   door: when the user asks for substantial work IN CHAT, Claude creates the task itself
   (source `assistant`), then runs the identical discipline — clearance if needed, sizing fork,
   plan + steps against the task, execute. The standing prompt line's job is exactly this:
   point Claude at the notebook so chat asks and panel tasks get one flow, one visibility.

## Forks for Kafi (recommendations first)

1. **`tasks.planId` fate.** Recommend: **keep the column, stop teaching it.** The notebook and
   tools move to `plans.taskId`; `tasks.planId` stays as the day-planning relation
   (PlanViewDialog's work items) until we deliberately retire it. Dropping it mid-arc drags the
   plans UI into this move for no user-visible win.
2. **`task_steps` table vs `taskId` column on `session_todos`.** Recommend: **new table.**
   Reusing the dock table breaks its per-session whole-list-replace semantics the moment one
   session works two tasks, and entangles two different questions in one home.
3. **Attachments on tasks.** Recommend: **own slice, sequenced last** — needs the files-linkage
   design (how a user pins a file to a task) and nothing else in the arc depends on it.
4. **Clearance surface.** Recommend: **Ask as-is** + the loose `taskId` on `ask_requests`.
   A new mechanism would duplicate a shipped wizard.
5. **Notification seam.** Recommend: **session-comms nudge to the workspace primary** (above).
   A monitor-based wake is heavier and adds a standing row per workspace for a built-in
   behavior.

## Slices (gate-green at each step)

1. **Leaf:** `task_steps` schema + migration + repos + ops + events (+ `assignedSessionId`,
   `plans.taskId` in the same migration set) + tests.
2. **Surface:** routes (`set_task_steps` door, steps rollup on list, plan `taskId`,
   ask `taskId`) + `api:generate` + parity guards + prompt-section updates.
3. **Pickup:** the `task.created` nudge seam + the `assignedSessionId` stamp on pickup + tests.
4. **UI:** TasksPanel rework (header activity, sessions box, step expanders, default-open) +
   TaskViewDialog growth + component tests.
5. **Notebook:** the `task-planner.md` rewrite (+ align `TASKS_PROMPT_INSTRUCTIONS` so the
   standing line points at the notebook for the full discipline).
6. **Deferred within the arc:** task attachments (fork ③), workspace→session task feeding
   (column is data-ready), channels digest.

## Ownership clearance (Kafi, 2026-08-18)

**Spawned agents just complete the task; the SPAWNING session owns the bookkeeping.** When a
session hands task work to a spawned agent, the plan and the steps stay the spawner's to
maintain — the agent does the work and reports back; it does not touch `set_task_steps` or the
plan. This also defuses the ask-less-delivery concern in practice: the manager session running
the clearance/steps discipline is an interactive-capable surface.

## Open fork for Kafi (surfaced by the slice-5 review, 2026-08-18)

**`ask_user` on the nudge's own turn.** The pickup nudge runs as a report-delivery turn on the
workspace primary, and that turn kind composes NO ask descriptor — so clearance cannot use the
wizard there. The notebook covers it gracefully (questions go in the reply, task stays open,
pickup on answer), but the richer option is extending ask to workspace-primary delivery turns.
That is NOT a slip-in: a parked wizard on a delivery turn HOLDS the target's whole delivery
queue (claim excludes busy targets), so it needs the unattended-surface bounded-timeout
treatment (the channels precedent) and Kafi's call.
