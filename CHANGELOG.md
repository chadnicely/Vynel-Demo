# Changelog

All notable changes to Vynel are recorded here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the fuller rebuild narrative (per-module notes, the
module-by-module move log) lives in `.claude/journal/` and `.claude/STATE.md`. Entries begin from the
`@vynel/session` keystone (2026-07-04).

## [Unreleased]

### Added

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
  once then disarms); create exposes both. Fire-now (drives a headless turn) is deferred to the session app-wiring.
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
