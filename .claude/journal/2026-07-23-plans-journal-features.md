# 2026-07-23 — Plans + Journal features (the Tasks template, twice)

Chad: "create 2 new features like task — 1. Plan 2. Journal. Plans store plans date-wise with
details, add planId on task. Journal keeps daily history Claude can read to understand the flow;
expose through MCP."

## What shipped

Two net-new leaves built on the Tasks template (module notes: `docs/module-notes/plans.md`,
`docs/module-notes/journal.md`):

- **`@vynel/plans`** — `plans` table (migration `0016_plans`), `planDate` as a text `YYYY-MM-DD`
  day (calendar semantics — sorts as text, no timezone drift), tasks-style status/source/
  completion rule, outbox events, two-door routes, five MCP tools. `tasks` grew a loose `planId`
  text ref (same migration, additive ALTER; NO FK — sibling leaves) + a `planId` filter on both
  list surfaces.
- **`@vynel/journal`** — `journal_entries` table (migration `0017_journal_entries`), many
  entries per day, day + inclusive from/to range reads. **The agent door is append+read only**
  (add_journal_entry / list_journal_entries) — rewriting history is the user's door alone; that
  asymmetry IS the trust story, stronger than tasks.
- Capabilities `plans` + `journal` (defaultEnabled) gate tools AND prompt sections together;
  `contributeWorkspacePrompt` generalized from tasks-only to an ordered per-capability section
  list. 61 MCP tools total (was 53).

## Learnings

- **Two migrations from one config round-trip**: registered the plans schema alone, generated
  `0016`, then added journal and generated `0017` — one migration per feature commit-unit
  without hand-writing SQL. The tasks `ALTER` came out additive (no recreate) — verified before
  trusting it (the 0012 lesson).
- **The reviewer's catch**: sharing `ListTasksQuerySchema` between the two task list doors made
  `list_my_tasks` *advertise* a `planId` filter the user-scoped repo silently ignored — a
  wrong-data (not error) failure. When a shared request schema grows a field, every route that
  validates with it must thread the field or split the schema.
- Pins swept for a new capability: capabilities catalog tests ×3 files, SDK namespace list, MCP
  tool-name list, descriptor gate/prompt test.

## Round 2 (same day): UI + CLI (Chad: "complete the ui and cli as well")

PlansSection/JournalSection on both scopes (day-grouped, `format-day-label.ts` — the CLIENT
owns "today", never the server), PlanRow reusing TaskStatusControl (same status vocabulary —
the reviewer's catch: the control hard-coded "task" in its aria-labels, fixed with a `noun`
prop), vue-query composables, CLI `vynel plans|journal` command groups over the user-scoped SDK
namespaces with a shared `day-flag.ts` date-flag home. Reviewer clean; 2 should-fixes folded
(day-label unit tests + the noun prop).

**Learning:** commander's `.exitOverride()` does NOT propagate to subcommands already created —
a flag-validation test through `parseAsync` hits `process.exit`; test the parser function
(`toDayKey`) directly instead.

## Round 3 (same day): chat-linkable plan review + View/Edit everywhere

Chad: "component that can show plan… claude can link it in chat… edit and view option on both
lists… fixed width same for task." Built: the `vynel://plan/<id>` scheme (DOMPurify allowlist
widen in MarkdownText + ONE capture-phase link router in AppShell), the shared PlanViewDialog
(ui-store keyed; plan + live work items), View/Edit/Delete via a fixed-width RowActions cluster
on all three lists, per-feature view/edit dialogs, prompt teaching for the link syntax.

**Learnings:**
- **View dialogs resolve rows LIVE by id; edit dialogs snapshot.** The reviewer caught the
  snapshot-prop TaskViewDialog freezing its status cycle after one transition — the control
  computes the next transition from the displayed status, so stale display = same request
  forever.
- A widened DOMPurify `ALLOWED_URI_REGEXP` must be re-derived from the INSTALLED version's
  default (ours had silently dropped `matrix:` — tighter, but the comment lied).
- vue-query test mocks with mutable backing state must return a fresh array per fetch —
  structural sharing swallows in-place mutations of the cached reference.
- DOMPurify admits `VYNEL://` (case-insensitive), so scheme routing must match
  case-insensitively too.

## Deferred

Dashboard cards · journal "load older" past the 100-row cap · calendar-validity sweep on the
day-key regex (admits `2026-13-40`) · a `surface` field on SessionToolContext so link teaching
can gate to app-connected turns. Global root keeps zero plan/journal tools (router precedent).
