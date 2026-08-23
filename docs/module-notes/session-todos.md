# session-todos — the working-steps dock

> **RETIRED 2026-08-24** (Kafi): the dock element is commented out in the three views and
> `set_todos` no longer ships as a tool — the task panel's tasks + steps (`set_task_steps`) are
> the one visible work-tracking home. The `PUT /todos` route keeps the contract for a deliberate
> reconnect. This note stays as the record of the original design.

**Shipped 2026-08-02 (five-task session, Task 5).** A Claude Code-style TODO strip at the bottom
of every chat, directly above the composer: the session maintains its working steps there; the
user can tick items off and remove them. Auto-hides when empty.

## What this is (and is not)

- **Todos ≠ tasks.** A `tasks` row is a durable work item the user recognizes ("Write the spring
  newsletter"). A `session_todos` row is a STEP of the work currently in flight — Claude Code's
  `TodoWrite` semantics. The right-side `TasksPanel` and everything in `packages/tasks/src/{lifecycle,queries}`
  are untouched conceptually.
- **Durable, session-scoped.** Rows survive reload/resume. Each row carries a loose `sessionId`
  text ref (NO FK) — the SDK/chat session the steps belong to.
- **Same leaf.** `session_todos` is a SIBLING TABLE inside `@vynel/tasks` (the work-tracking leaf),
  not a new package — the leaf-owns-schema invariant.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Whole-list replace** (`replaceSessionTodos` deletes the session's rows and re-inserts) | Claude Code's TodoWrite semantics. Title-keyed id preservation was considered and rejected: it does NOT fix the only race that matters (the user ticks a box, Claude's next `set_todos` carries its own view of that item's status and overwrites it), so it buys ~25 lines of diffing for nothing. |
| 2 | **ONE tool: `set_todos`** | "Prefer fewer tools." The model holds its own list; a read tool would only invite it to re-read what it just wrote. The tool returns the persisted list, so the write IS the read. |
| 3 | **Session identity is server-stamped via an ambient header** (`x-vynel-turn-session`), never a tool argument | A model-supplied session id would let one session write another's dock. Mirrors `report-requester-header.ts` / `report-caller-header.ts` verbatim. |
| 4 | The header carrier is **MUTABLE per turn** (`createTurnSessionCarrier`) | A FRESH conversation has no session id at MCP-compose time — the id arrives with `session-created`. The `mentionPlan.onSessionResolved` seam has exactly this shape at exactly these call sites. Seeded with `resumeSessionId` when known, so every resumed turn is stamped from byte zero. Ordering is safe: `user-message-persisted` is EVERY turn's first event (`session-turn-channel.ts` states this as an invariant) and it precedes the model's first tool call by a full network round trip. |
| 5 | The route **resolves the session row** and derives `workspaceId` from it | Kills the "who supplies the workspace scope" question: the header id must be a chat session the caller owns, or the tool 400s. |
| 6 | **No tool-set flip per turn origin** — `set_todos` rides `workspaceSurface` + `rootSurface`, so it exists on every turn | `build-workspace-background-mcp.ts` documents at length that a toolset that changes between a workspace primary's interactive and background turns triggers the SDK's deferred-tool reconciliation ("MCP server disconnected", 2026-07-21 live bug). Denying one tool on background composers would recreate that class. |
| 7 | An unstamped turn gets an honest **400 with an actionable message**, not a silent no-op | The `report_to_requester` precedent ("if it says there is no requester, simply reply with your findings as text instead"). |

## Files

**Schema + package (`packages/tasks`)**
- `src/schema/session-todos.ts` — the table (registered in `drizzle.sqlite.config.ts`)
- `src/repositories/session-todos.ts` — functional repo, `db` first arg
- `src/session-todos-events.ts` — `session-todos.replaced` / `session-todo.updated` / `session-todo.deleted`
- `src/todos/{replace-session-todos,update-todo-status,delete-todo,list-todos-for-session}.ts`

**Migration**: `packages/db/src/migrations-sqlite/0028_session_todos.sql` — drizzle-GENERATED
(`pnpm --filter @vynel/db exec drizzle-kit generate --config=../../drizzle.sqlite.config.ts`).
Never hand-written; the journal is never edited.

**API (`apps/local-api`)**
- `src/routes/todos/{index,schemas,serializers}.ts` — ONE app at `/todos`; `PUT /` is the agent
  door (x-mcp `set_todos`), `GET /` + `PATCH /:todoId` + `DELETE /:todoId` are the user door
  (no x-mcp).
- `src/sessions/turn-session-header.ts` — the ambient session-identity carrier + header.
- Wired in `streams/chat-turn.ts`, `streams/global-root-turn.ts`, `streams/session-turn.ts`.

**MCP (`apps/mcp`)** — `set_todos` joins the `tasks` capability gate on both workspace
descriptors; `TODOS_PROMPT_INSTRUCTIONS` is contributed by the workspace descriptors (gated on
`tasks`) and by the routing descriptor (the global root has no capability rows).

**Web (`apps/local-web`)**
- `src/components/chat/TodoDock.vue` — mounted inside `footer.composer-dock` above
  `QueuedMessageChips` in `GlobalChatView.vue`, `WorkspaceView.vue`, `SessionThreadView.vue`.
- `src/composables/todos/{todo-keys,use-session-todos,use-update-todo-status,use-delete-todo}.ts`
- Live updates: `composables/chat/work-view-invalidation.ts` is the ONE home for "which tool
  changed the work views". Wired into all three live-event ingests —
  `composables/chat/use-chat-turn.ts` and `composables/sessions/use-session-turn.ts` (settle +
  mid-turn), and `composables/chat/use-watched-turn.ts` (mid-turn), so a turn this tab only
  WATCHES ticks the dock too. This also fixes the standing bug that task mutations by Claude
  never refreshed the panel: `invalidateTaskViews` existed but only user mutations called it.

## Deferred (recorded, not done)

- **Background turns cannot track steps.** Schedule fires (`build-schedule-fire-deps.ts`) and
  delegation ticks (`buildDelegatedTurnMcpComposer`) never stamp the header, so `set_todos` 400s
  there. The tool stays present (decision 6) and says why. Wiring them means threading the
  resumed SDK session id out of the delegation/schedule cores — a deliberate move, not a slip-in.
  Note the sharp edge: those turns are also PROMPTED for it —
  `vynelRoutingDescriptor.contributePrompt` is unconditional and a global-grounded spawned
  session's delegated turn composes that descriptor, so the model is told to keep a step list it
  cannot write. The tool description gives it a graceful out ("simply carry on without it"), so
  this is a wart, not a break — but it is the "steered into calls that can only fail" shape
  `compose-session-mcp-servers.ts` warns about, and it closes the day the header is threaded.
- **A pressure swap orphans the pre-swap rows** on the dead segment (nothing reads them; hard
  rows, no cleanup job yet). Harmless by construction: whole-list replace means the post-swap
  `set_todos` carries the complete list onto the new segment.
- **A compaction swap starts a fresh dock.** Todos key on the SDK segment id; when a
  pressure swap moves the thread to a new segment the dock reads empty. Judged CORRECT (a fresh
  segment legitimately has fresh steps), not a bug — but it is a behavior to know.
- **Invalidation reaches the driving tab and any tab WATCHING that session's channel.** A tab
  showing a DIFFERENT session than the one being written still refreshes only on its own poll —
  correct, since its dock is a different list.
- **No reorder affordance.** `orderIndex` exists and is honored; only `set_todos` writes it.
