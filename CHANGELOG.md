# Changelog

All notable changes to Vynel are recorded here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the fuller rebuild narrative (per-module notes, the
module-by-module move log) lives in `.claude/journal/` and `.claude/STATE.md`. Entries begin from the
`@vynel/session` keystone (2026-07-04).

## [Unreleased]

### Added

- **The complete HTTP API surface — every remaining vertical landed** (109 paths → 131 typed SDK
  methods across 22 namespaces, 33 MCP tools): workspaces, memory, agents, capabilities, users,
  files, **chat (12 routes + the `chat-turn` SSE stream)**, **root (global chat reads + the
  `global-root-turn` SSE stream + delegation trace drill-down)**, **routing (task dispatch to
  workspaces + proactive channel sends, executed by a new boot-time delegation service)**,
  providers (install/auth status), **onboarding** (new decoupled `@vynel/onboarding` leaf, 5 wizard
  routes, first-launch gate — production 412s non-onboarding routes until setup completes),
  approvals workspace pending/audit + approval-rules, and the net-new `GET /dashboard/overview`
  aggregate for the Home screen.
- **Typed responses everywhere:** every JSON 200/201 now declares its real wire shape (previously
  75 of 83 operations were description-only, so the generated SDK returned `Promise<never>` for
  everything except knowledge — the UI's typed data layer now actually holds repo-wide).

### Changed

- **Desktop UI now runs on the real API, not demo data (M7).** Deleted the hand-written demo
  namespaces and the scripted turn player; `workspaces`, `dashboard`, and the whole chat vertical
  (session reads + live turns + approvals + interrupt) now hit the generated SDK. Live turns stream
  over the real `chat-turn` / `global-root-turn` SSE via a typed `parseAs:'stream'` POST fed through
  a pure frame parser; approvals decide through the real API and the stream reflects the resolution.
  Global chat is one continuous conversation (`root.*`, no history list); workspace chat is `chat.*`.
  The workspace drawer's feature sections (skills, channels, schedules, knowledge, marketplace) read
  their real per-domain lists, each fetched only while its section is open. The composer's model
  picker is the real curated `CHAT_MODELS` allowlist, and the chosen model rides on every turn.
  Contracts `ChatSessionResponse.workspaceId` is now nullable and
  `ChatToolCallResponse.toolInput`/`toolOutput` optional, matching the wire.

### Fixed

- Namespaced-SDK generator: path params are typed from the OpenAPI spec (a literal-enum path param
  like capabilities' `capabilityId` previously broke the generated client's typecheck).
- Home dashboard: global-root conversation rows carry `workspaceId: null` on the real wire; the
  view now routes them to the global chat (the demo had used a sentinel id).

- **`@vynel/ui` — the shared component library** (design tokens + components for every Vynel surface).
  Cool-slate dark/light token system with ONE reserved accent — gold means "the assistant is running or
  needs you" (presence dot, live pulses, approval cards, stream cursor). Components: SegmentedTabs,
  IconButton, EmptyState, PresenceDot, MarkdownText (sanitized), MessageRow, ThinkingBlock, ApprovalCard,
  CodeBlock (lazy shiki highlighting + line numbers), ToolCallCard (tool-aware: Read → highlighted file
  content, Edit → before/after diff, Bash → terminal, unknown → payload panes), ToolCallList ("Read 2 files"
  grouping).
- **`apps/local-web` — the desktop web UI** (Vue 3 + Vite + Pinia + vue-query over the typed SDK).
  Custom titlebar (menu · history toggle · workspace switcher · new conversation · tabs · presence dot);
  **continuous-first chat** — Chat and each Workspace open straight into the one ongoing conversation,
  with session history opt-in behind a toggle and a persistent menu panel whose items (Application,
  the workspace feature sections) render on the canvas; the approval notifier — pending approvals
  surface bottom-right as decidable cards on ANY view (polls the live approvals API).
  Runs on a **contracts-typed demo seam** until the chat/workspaces routes land: hand-written demo
  namespaces on the SDK client + a scripted `ChatTurnEvent` player (thinking, text, tool calls, a real
  approval pause, interrupt) — swap = regenerate SDK + delete `src/demo/`.
- **Workspace tab, Home dashboard, and the Jarvis voice demo** (`apps/local-web`, demo-phase). The
  Workspace room: workspace switcher (persisted), its own sessions + chat, a files panel, and the hidden
  menu's seven feature sections (Skills / Channels / Schedules / Knowledge / Marketplace demo lists typed
  by the real contracts; Memory / Agents arrive with their APIs). Home: recent conversations across
  every scope, workspaces with their manager personas, upcoming schedules, and the approvals note. Voice:
  the `VoiceOrb` (pure-CSS gold presence, six states) behind the titlebar mic — a scripted demo loop
  until the voice engine module lands; the future Tauri overlay window mounts the same orb.

- **`@vynel/session` — the workspace turn machinery** (Slice 2b). The workspace chat runner (`startChatTurn`),
  the seed-fresh swap primitive (`runSeededSwapSession`), the primary-conversation resolver, post-turn
  continuity-application (link the durable "primary" session + pressure-bridge swap when context fills), and the
  per-turn capabilities prompt composer. This completes the `@vynel/session` package — global-root core
  (Slice 2a) + workspace machinery + resolvers + composers + continuity.
- **`@vynel/chat/repositories`** subpath export — surfaces the chat repositories for cross-package composition
  by the session tier, the faithful analog of the former kernel `@vynel/db/repositories/chat`.
- **Global approval queue — backend foundation** (`@vynel/approvals`). Global-root ("brain") approval cards now
  **persist** (they were previously dropped and lost to the stream — the root cause of stuck/never-shown
  approvals); `listPendingApprovalsForUser` lists every pending card for a user across all sessions/workspaces +
  the brain; and `resolveApproval` is **user-scoped**, so a workspace-less card can be answered from any surface
  rather than only timing out. This is the backend the "answer approvals from any screen" experience runs on
  (the HTTP routes + notification UI arrive with `apps/api`).

- **Approval queue HTTP surface** (`apps/local-api`) — `GET /approvals/pending` + `POST /approvals/:id/decide` over
  the global-queue backend, with a typed SDK (`client.approvals.listPending()` / `.decide()`). Withheld from MCP —
  approvals are the sensitive human-in-the-loop path an agent must never self-approve.

- **`@vynel/voice`** — the stateless voice-relay functional core (wake-word, audio segmenting, turn-taking,
  barge-in, sentence buffering, spoken-summary + fire-and-notify), folded into `turn-taking/` + `relay/`.
- **`@vynel/skills` + skills HTTP API** — the skills leaf (install / uninstall / enable / disable / settings /
  list / sync-with-provider) with a typed SDK (`client.skills.*`, 8 methods) and 2 read MCP tools
  (`list_available_skills`, `list_installed_skills`). Install/uninstall stay off MCP (host-disk mutations).
- **`@vynel/channels` + channels HTTP API** — the channels leaf (connect / disconnect / enable / allowed-senders /
  history, Telegram adapter) with 9 routes, `client.channels.*` (9 methods) and 2 read MCP tools. Responses strip
  the bot token + poll cursor; the connect route (carries the token) is withheld from MCP.
- **`@vynel/schedules` + schedules HTTP API** — the schedules leaf (create / update / enable / disable / delete /
  list / runs / templates) with 8 CRUD routes, `client.schedules.*` (8 methods) and 3 read MCP tools. A schedule
  is **recurring** (a cron expression) or **one-time** (a `fireAt` timestamp — "remind me in 20 minutes" — fires
  once then disarms); create exposes both. An explicit `scheduleKind` column now names the two kinds.
- **Schedules FIRE end-to-end** — the ③ agent-turn MCP binding (`composeSessionMcpServers` + the in-process
  `vynel` server built from the api's own `app.request`) plus a per-minute boot poll service and a
  `POST /schedules/:id/fire-now` route. A due (or manually-fired) schedule now runs a real headless workspace
  turn with the route-derived Vynel tools attached. Fire-now is SDK-only — a turn is never itself an agent tool.
- **Global-or-workspace is API-reachable** — user-scoped `/channels` + `/schedules` route groups (create with a
  `scope` field, list-all, full id-ops) sit alongside the workspace-scoped routes, so a _global_ channel or
  schedule can be created, listed, and managed. Every id-op authorizes by `userId` (tenant-safe).
- **`@vynel/marketplace` + marketplace HTTP API** — the table-less marketplace leaf (browse + get catalog items,
  annotated with per-user install-status) and `client.marketplace.*` (2 methods). Install-status is composed at the
  route from `@vynel/skills` (kept off MCP — its reads are the join of already-exposed skills tools).

### Changed

- **`@vynel/skills` / `@vynel/channels` / `@vynel/schedules` own their schema + repositories** (moved from the
  `@vynel/db` kernel — the vertical-slice shape). All behavior-neutral relocations (drizzle "No schema changes").
- **`channels.workspaceId` and `schedules.workspaceId` are now nullable** — a channel or schedule can target a
  **workspace** or be **global** (null). Baseline-folded (pre-release, zero data). The workspace-scoped fire path
  keeps its owner-check unchanged; a global schedule fires without a workspace.
- **Cross-feature seams decoupled via dependency injection** — as they became `@vynel/<feature>` leaves, channels
  and schedules stopped importing sibling leaves: the approval-resolve (`channels`) and turn-firing
  (`startChatTurn`, `schedules`) calls are now injected through their existing `Deps` seams (the app/worker
  composition layer binds the real functions), and cross-domain event types resolve through `@vynel/contracts`.
  Their poll-tick worker bodies are deferred to the session app-wiring.

- `@vynel/approvals` now owns its schema + repositories (moved from the `@vynel/db` kernel — the vertical-slice
  shape). `approval_requests.workspaceId` is now nullable (holds workspace-less brain cards). Behavior-neutral
  schema relocation (drizzle "No schema changes").
