# Journal — module notes

**Status:** requested by Chad 2026-07-23 ("Journal … keep history in journal format to keep
track what's happening everyday, claude can read them and understand the flow of daily works,
also expose them through mcp") · net-new leaf, *built* (not pulled), tasks-template gates.
**Arc:** Plans + Journal, built together on the Tasks template.

## Chad's advice (the why)

- A **daily work journal**: dated entries recording what happened, so the assistant can read
  back and understand the flow of the last days' work when picking a thread back up.
- **Exposed through MCP** — the assistant both writes entries as work lands and reads them for
  context.

## Shape

### Leaf: `packages/journal` (`@vynel/journal`)

Template: `packages/tasks` (structure, barrel, test-support).

**Schema** — `schema/journal-entries.ts`, registered in `drizzle.sqlite.config.ts`, migration
`0017_journal_entries`:

| column | notes |
|---|---|
| `id` | PK |
| `userId` | `id().references(users.id, cascade)` — tenant, non-null |
| `workspaceId` | nullable `text().references(workspaces.id, cascade)` — NULL = global |
| `entryDate` | non-null `text()` `YYYY-MM-DD` — the day the entry belongs to |
| `content` | non-null, ≤8000 — the entry body (journal prose, longer than task detail) |
| `source` | `'assistant' \| 'user'` |
| `sessionId` | nullable loose `text()` ref (NO FK) |
| `createdAt` / `updatedAt` | append-time / edit-time |

Indexes: `(userId, workspaceId)`, `(userId, entryDate)`.

**Many entries per day, append-style** — a journal is a flow, not one document per day; each
entry is a moment. Lists return newest-first (entryDate desc, createdAt desc), capped.
`entryDate` is a text day (see plans.md for the rationale); `ENTRY_DATE_PATTERN` shared between
core op and route schema.

### Routes: `apps/local-api/src/routes/journal/`

Mirror `routes/tasks/`. **The agent door is APPEND + READ ONLY** — the journal is the record;
rewriting history is the user's call, never the assistant's. That's the trust story (stronger
than tasks, where the agent updates status):

| tool | route | mutating |
|---|---|---|
| `list_journal_entries` | GET workspace-scoped (query: `entryDate`, `from`, `to`, `limit`) | no |
| `add_journal_entry` | POST workspace-scoped (`entryDate` + `content`) | `mutatingApproved` |
| `list_my_journal_entries` | GET user-scoped (both scopes) | no |

User door additionally: POST (scope union, source `'user'`), PATCH `:entryId`
(content/entryDate), DELETE `:entryId` — panel/CLI only, not MCP-exposed.

`x-sdk-name`: `journal.*` / `journalUser.*`. Writes uncarded (`mutatingApproved`).

### Capability + prompt

- `journal` in `CapabilityId` + `CAPABILITY_CATALOG` (`defaultEnabled: true`) + the route enum.
- The three tools in `VYNEL_CAPABILITY_GATED_TOOLS.journal`; `JOURNAL_PROMPT_INSTRUCTIONS`
  section: read recent entries when resuming work to understand the flow; append a dated entry
  when meaningful work lands (what happened + decisions, plain language); never rewrite history.
- Global root: NO journal tools in v1.

## Decisions taken

- **`entryDate` required, no server-side "today" default** — "today" is a timezone question the
  server shouldn't answer; the model and the panel both know the date.
- **No `title` column** — journal entries are prose moments; the date IS the grouping.
- **Agent cannot edit or delete entries** — append-only provenance is what makes the journal
  readable as history.
- **Date-range list (`from`/`to`) ships in v1** — "understand the flow of daily works" is
  inherently a range read, unlike plans.

### UI + CLI (built 2026-07-23, Chad's green light)

- **JournalSection** (`apps/local-web/src/components/sections/JournalSection.vue` +
  `JournalEntryRow.vue`) — both scopes, day-grouped newest-first (`utils/format-day-label.ts`),
  prose-first rows with writer chips, textarea composer (date defaults to today), hover delete
  (the user's door — matching the append-only agent contract). **No inline edit in v1** — the
  journal reads as a record; delete covers a bad entry.
- Composables `composables/journal/*` (vue-query). Icons: `NotebookPen`.
- **CLI** `vynel journal list [--date|--from|--to] | add [--date default-today|-w] | delete`
  (`apps/cli/src/journal-commands.ts`).

### View/Edit (built 2026-07-23 round 3, Chad's ask)

- Rows wear the shared fixed-width `RowActions` cluster (View/Edit/Delete, aligned with tasks
  and plans; the entry's day in the aria labels keeps sibling rows distinct).
- `JournalEntryViewDialog` (full-entry read) + `EditJournalEntryDialog` (content/day) — both
  USER doors over `journalUser.update`/`delete`; the agent's surface stays append-only.

## Deferred (deliberate)
- Pagination / "load older" past the 100-row default cap — journal is the surface that will hit
  it first; a date-range picker rides the same touch.
- Cross-workspace daily digest ("what happened everywhere yesterday") — a formatted composite
  read; the user-scoped list already answers it raw.
