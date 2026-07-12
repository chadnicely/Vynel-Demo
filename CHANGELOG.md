# Changelog

All notable changes to Vynel are recorded here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the fuller rebuild narrative (per-module notes, the
module-by-module move log) lives in `.claude/journal/` and `.claude/STATE.md`. Entries begin from the
`@vynel/session` keystone (2026-07-04).

## [Unreleased]

### Added

- **Paste or attach files and images in chat — and Claude actually receives them.** Paste a
  screenshot, drop a PDF onto the message box, or pick files with the attach button; they ride the
  message in the main chat and in every workspace room (images, PDF, Word, Excel, PowerPoint, text,
  markdown, CSV, HTML, JSON — up to 6 files, 5 MB each). Sent messages show what rode along as quiet
  chips; unsupported or oversized files are declined in plain words before anything is sent.

- **The chat mic now types for you.** The little mic in the message box is dictation — talk and your
  words appear in the box for you to read and send yourself. Nothing is sent until you press Send.
  Talking WITH Claude stays one click away: the mic in the top bar opens the voice overlay, which
  always appears mid-screen (the floating desktop orb now centers itself too).

- **Memory has tags — and the special "context" tag Claude keeps for you.** Every memory can carry
  a few short labels: pick from suggestions (context, preference, person, project, decision,
  routine, reminder, note), reuse what you've coined before, or type a new one. Tag a memory
  **context** and it becomes part of what Claude always knows in that workspace — every fresh
  conversation starts from those facts, and Claude is instructed to keep them current (updating a
  standing fact instead of piling up duplicates). A memory can also be imported straight **from a
  file** — pick a document and its text is remembered, tags and all.

### Added

- **Remove what you added — channels and marketplace items.** Every connected channel row now has
  a remove control, and every installed marketplace item (skills and agents alike) has a Remove
  button that flips the card back to "Get". Both use a two-step confirm — the first click arms a
  "Sure?", only the second acts — because disconnecting a channel means re-entering its bot token,
  and removals aren't undoable. Removing an item only ever touches the marketplace-installed copy:
  an agent you built yourself can never be swept up by it, even if it shares a name with a catalog
  item.

### Added

- **The Notebook — curated playbooks Claude reads when the task calls for them.** A new Notebook
  section (global menu and every workspace) holds two shelves: **verified books** shipped with the
  app — starting with a web-app build playbook and a plain-language communication guide — and
  **your own books**, written right in the app. When you start a matching task, Claude checks the
  shelf and follows the book's current guidance instead of guessing from stale training knowledge.
  Claude can only *read* books, never change them; verified books can't be edited by anyone in the
  app, and your books are yours alone. Toggling the Notebook capability off removes both the tools
  and the suggestion to use them.

- **Publish new marketplace items straight from the admin portal.** The catalog page gained a
  "Publish item" button opening a full form — pick the kind (skills and agents install in the app
  today; other kinds publish but stay hidden until supported), fill in the details, attach the zip,
  and publish as a draft or live. The `pnpm cloud:publish` command also now reads the project's
  `.env` on its own instead of failing when the admin token isn't exported in the shell.

### Changed

- **Every agent change now leaves a durable event trail.** Creating, editing, or deleting an agent
  records an event in the same transaction as the change itself (deleting previously ran outside
  any transaction) — the same bookkeeping every other feature already had, groundwork for sync and
  activity feeds.

### Added

- **Marketplace agents — install a ready-made helper, not just skills.** Items of kind "agent"
  published to the hub now appear in the app's marketplace with an Agent badge, and Get installs
  them as a real agent (persona, model, working style) marked as community-sourced. Every install
  is integrity-checked against the catalog's fingerprint before anything is read, a malicious or
  oversized package is rejected before it can waste memory, and no community agent can skip the
  approval card on irreversible actions — that floor is enforced by the app itself, not by the
  package. Other kinds (MCPs, rules, plugins) stay hidden until they're actually installable.

- **A real admin portal for the marketplace hub.** `apps/cloud-admin-web` is a small web app where
  hub admins sign in with their own account and manage the catalog visually: every item (drafts
  included) in one table, metadata editing, pull-from-distribution and restore with a confirm step,
  version history with integrity fingerprints, publishing a new version by picking a zip, and
  provisioning accounts/roles — no more curl for day-to-day catalog work. Validation errors from
  the hub now arrive as the same plain `{code, message}` shape everywhere, so the portal (and any
  future client) can show exactly what was wrong.

- **The marketplace hub now has real admin machinery (the portal's backend).** Hub accounts can
  carry an admin role — granted once with the server's own key, revocable instantly, and checked
  fresh on every request so a removed admin loses access immediately. Admins can list the whole
  catalog including drafts, edit an item's details, and pull an item from distribution ("yank") —
  which hides it from browsing and blocks new installs on the spot, while people who already
  installed it keep a working copy. Yanking is reversible; published versions themselves are never
  altered or deleted, so every install stays verifiable forever.

### Changed

- **Internal reorganization — nothing changes in how the app behaves.** The session engine's
  delegation machinery (routing a task into a workspace's brain, running queued delegations,
  surfacing approval cards, reading a request's trace) moved from the api app into the
  `@vynel/session` package where the rest of the session engine lives, and the marketplace hub's
  publish/download rules (the 10MB cap, the tamper-proof version check, the tier gates) moved from
  its web routes into the registry package. Every behavior was verified unchanged; the upcoming
  admin portal builds directly on these relocated pieces.

### Fixed

- **Knowledge folders actually index now — and keep indexing after a restart.** Two invisible gaps
  made "add a folder" look dead: folder watchers were never re-opened when the app restarted, and
  the background embedding step never ran in the desktop app at all (it lived in a worker process
  nothing launched). Both now run inside the app itself: sources re-index on boot (catching files
  changed while the app was closed), file changes index live, and search embeddings generate within
  a minute — for knowledge *and* memory. Each knowledge source row now shows its real status ("12
  files indexed · updated 2m ago") instead of sitting silent, and single FILES can be added to the
  vault, not just folders.

### Added

- **The knowledge vault and Claude's memory are now manageable in the app — globally or per
  workspace.** Knowledge: point Claude at any folder with a real folder browser and it indexes
  everything readable inside for search — sources live globally ("searchable everywhere") or in one
  workspace, and can be removed with one click. Memory: read everything Claude remembers (the global
  menu shows every workspace's memories with scope chips) and add your own — a note, a preference, a
  person, a business fact, a pattern. Both sections invite the first item instead of showing an
  empty pane.

- **Connect channels and create schedules from the app — on the global menu and in every
  workspace.** Channels: a guided connect dialog (Telegram with the @BotFather walkthrough; Discord
  marked coming soon) with a "where it lives" choice — global or one workspace — and empty states
  that invite the first connect. Schedules: tell Claude what to do and when — **once** (in 15
  minutes, in an hour, tomorrow 9 AM, or any picked moment) or **repeating** (daily / weekly on a
  weekday / monthly on a day, at your chosen time). Schedule rows read in plain words ("Daily at
  9:00 AM · next Fri 9:00 AM") and pause/resume with one click.

### Fixed

- **The "+" next to the workspace switcher now does what it looks like it does — create a
  workspace.** It used to silently start a fresh conversation (often invisible on an empty room).
  Starting a new conversation moved to where conversations live: the "+ New" button atop the
  Conversations panel.

### Added

- **Messages remember how they reached Claude.** A message you speak through the voice channel now
  wears a quiet "via Voice" mark beside it in the conversation (Telegram messages likewise), so a
  transcript mixing typed, spoken, and channel messages stays legible at a glance. Applies to
  messages from now on — history from before this release has no origin recorded.

- **The chat opens with a real arrival moment, and your assistant is Claude by name.** An empty
  conversation now greets you personally under Claude's coral spark — "Good morning" with your name,
  the channels Claude is reachable on (Telegram health, Voice with the wake phrase), and your
  workspaces as clickable cards wearing their accent colors with their manager's name ("vynel — with
  Ava"). Every reply is signed the same way: the assistant speaks as **Claude**, a workspace's
  manager by their own name ("Ava · vynel"), and saying "Hey Claude" now genuinely wakes the voice
  daemon. Workspace rooms get the identical welcome with their manager's mark in the workspace color,
  and their composer asks "Ask Ava for anything…".
- **The conversation scrolls like Discord.** Long history loads in pages — the newest 100 messages
  render instantly and scrolling to the top reveals more without losing your place. New replies
  follow at the bottom only while you're already there; if you've scrolled up to read, a floating
  "Jump to latest" pill takes you back instead of yanking you. Your own sends always land you at the
  latest message, and the whole thread got wider room to breathe.
- **Tool activity now reads like Claude Code, not JSON.** Each tool the assistant uses is a compact
  chip — "Wrote CLAUDE.md **+16** · 2.2s" — that expands into the real artifact: the file path in a
  header bar with a copy button, a unified diff with green/red +/- gutters and syntax highlighting,
  a terminal view for commands, the spoken sentence for `speak`. Assistant-internal tool ids
  ("mcp__vynel__route_to_workspace") show as plain words ("route to workspace").

- **Work is color-coded by workspace.** When the assistant hands a task to one of your workspaces,
  its report comes back wearing that workspace's own accent color: a colored bar down the message,
  plus a matching "Watch" chip and "Working in…" banner — so at a glance you can tell which workspace
  each result came from. Each workspace gets a stable, distinct color automatically (gold stays
  reserved for "the assistant is working here").
- **Voice is now a real communication channel — say "Hey Vynel" and talk to it like a person.** A
  new `speak` tool lets the assistant *choose* to answer out loud: voice requests run on the fast
  Haiku model, which does the work and then speaks a short, natural reply (no more reading a wall of
  markdown aloud). It hears you through the browser's accurate speech recognition and waits a real
  pause before deciding you're done — so you can think mid-sentence without being cut off. The reply
  plays in one consistent voice with no echo, and the same `speak` capability means any part of the
  assistant (a scheduled morning briefing, a finished background task) can talk to you when it makes
  sense. Needs the voice daemon running (`pnpm dev:voice`) plus Chrome or Edge / the desktop overlay.
- **A first-launch setup wizard — a fresh install now opens to a guided welcome instead of a dead
  screen.** The moment the app detects setup isn't finished (the API's first-launch gate), a
  full-window wizard takes over: say hello, tell Vynel your name and timezone, name your first
  workspace, seed your assistant's first memory about you, pick starter skills, optionally connect
  Telegram, and optionally schedule a morning briefing. Every step is driven by the real onboarding
  API — closing the app mid-setup resumes exactly where you left off, and "Start over" restarts the
  run. When the last step lands, one click opens the app with everything already in place.
- **Create a workspace from the app — the switcher's new "New workspace…" row.** A dialog names the
  workspace and walks your real folders (drives, up-navigation, live listing) to pick the existing
  directory it should live in; creating it selects it immediately. No more asking the assistant (or
  the CLI) just to add a room.
- **The Jarvis overlay is now a real desktop overlay — transparent, always-on-top, speaking in
  Vynel's own voice.** A thin Tauri shell (`apps/desktop`) hosts the orb as a frameless translucent
  card that floats above everything: saying "Hey Vynel" launches it (or reveals it instantly if it's
  already running, hidden), it transcribes live, and the reply is spoken with the daemon's Kokoro
  voice — the same voice whether the overlay or the native loop answers (browser speech is the
  automatic fallback if the daemon is away). Closing or silence hides the card; the next wake brings
  it back. A live probe on WebView2 unblocked this: Tauri's webview ships a fully working
  Web Speech recognizer (Azure-backed, punctuated finals), so the overlay keeps Google-grade STT.
  The Chrome app-window remains the fallback surface on machines without the built desktop app.
- **The Jarvis overlay — "Hey Vynel" now opens a floating voice window with Google-grade
  transcription.** The always-on daemon keeps waking locally (Moonshine — your room's audio never
  leaves the machine), but the command session now runs in a small floating Jarvis window: the Web
  Speech API (Chrome/Edge's cloud recognizer) transcribes what you say with a live word-by-word
  transcript in the orb, the brain answers over the same turn stream the chat uses, and the reply is
  spoken sentence-by-sentence while it's still being written. Say "Hey Vynel, …" — the window pops to
  front (launching if needed; the same-breath command survives the launch), follow-ups need no re-wake,
  and ~15 s of silence puts it away and hands the mic back to the daemon. With no browser around, the
  daemon still answers natively (Moonshine + Kokoro) exactly as before. The in-app mic button drives
  the same session in a page overlay; the scripted voice demo is gone.
- **`@vynel/voice-engine` — Vynel can now speak AND hear, on the CPU with no Python** (via
  `sherpa-onnx-node`, native ONNX). Model-agnostic contracts — `VoiceEngine` (text-to-speech) with a
  `SherpaVoiceEngine` backend (Kokoro's 11 natural voices, or a small VITS/piper voice) and
  `SpeechRecognizer` (speech-to-text) with a `SherpaSpeechRecognizer` backend (Moonshine) — plus pure
  config mappers and a `FakeVoiceEngine` for tests. `pnpm voice:fetch-models` downloads a model into a
  gitignored `.models/`; `pnpm voice:smoke` speaks a WAV; `pnpm voice:bench` reports the real-time factor
  of each model on your machine. **Measured on CPU: Moonshine transcribes ~70× faster than realtime,
  piper synthesizes ~14×** — ample headroom for the always-on loop. A `VoiceActivityDetector`
  (silero-VAD) segments a continuous mic stream into complete utterances.
- **`@vynel/voice-daemon` — the always-on "Hey Vynel" background service.** A standalone sidecar that
  listens on the mic (native audio via `node-cpal`, no browser), wakes on "Hey Vynel", holds a multi-turn
  conversation with the brain over its HTTP API, speaks the answers, and falls back asleep after a stretch
  of silence — entirely on the CPU, no Python. Built with an echo-defense gate (the mic stays shut until
  the speaker has actually finished, so it never hears itself) and a no-barge-in v1. The LuxTTS/Chatterbox
  voices plug in later behind the same engine contract.
- **Routed tasks can now DO work — with your approval (surface-up).** A task the brain routes to a
  workspace no longer auto-denies irreversible actions: the action pauses, an approval card appears in
  the app (always) *and* in the channel the request came from (Telegram — ✅/❌ buttons, or reply
  "approve" / "deny <reason>"), and whichever surface decides first resumes the task. Unanswered cards
  time out (~10 min) via a new reaper service, so a parked task always finishes with a report. The
  brain's own carded tools (e.g. creating a workspace from Telegram) reach the channel the same way.
- **The Ask/Auto/Bypass mode now governs the brain and routed tasks.** A global-chat turn carries the
  composer's mode; the brain's own tools respect it, and any task it routes inherits it (stored on the
  delegation job) — the mode picks which tools pause for approval.
- Channel approval cards for routed tasks name the acting workspace ("Write — in vynel"); routed agents
  are steered to read-only tools for read tasks; the Watch panel no longer shows the same answer twice.
- **Watch a routed task live, as it works.** A routed task's activity now persists the moment it happens
  — the task appears in the workspace chat instantly, the reply grows as it streams, and every tool call
  shows up as it runs (previously nothing appeared until the task finished, and tool calls weren't kept
  at all). The "Working in *{workspace}*…" indicator is now a clickable Watch pill that opens the live
  trace panel mid-run (with tool cards), and the workspace chat updates itself while a routed task runs.
  Watch chips only appear where they point at work happening elsewhere — the workspace's own transcript
  no longer shows them on its routed exchanges.

- **Watching is now truly live.** The Watch panel rides a streaming connection: text arrives
  token-by-token, tool calls appear the instant they start, and a "Waiting for your approval" pill shows
  while an action is paused on your decision. Polling remains only as an automatic fallback if the
  stream drops.
- **See delegated work happen.** When the brain routes a task to a workspace, the global chat now shows
  a live "⚡ Working in *{workspace}*…" indicator (polling the in-flight delegations) and keeps the thread
  live so the workspace's report appears within seconds of completing. A report's "Watch *X*" chip opens
  a right-side panel that fills in the delegation's condensed trace (task → workspace reply → report) as
  it runs. (Previously the report only surfaced on window-focus and the chip 404'd.)
- **The assistant can create workspaces (MCP tool).** `register_workspace` — a brain-surface, mutating
  MCP tool bound to the global-root turn — lets the user set up a new workspace straight from the global
  conversation ("set up a bookkeeping workspace in C:\Users\me\Bookkeeping"); it fires an approval card
  before creating. Introduces an `x-mcp.rootSurface` flag so a user-scoped route can be routed to the
  brain's toolset without living under `/routing/`.

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

- **Approval cards in the chat now say what's being asked.** The inline card classifies the action
  with the same taxonomy the server records — "wants to run a command", "wants to create a file" —
  and risky kinds (shell commands, deletes, outgoing email) get the danger treatment instead of the
  generic headline. The inline card and the corner notification can no longer disagree.
- **The Watch panel reads at a glance.** Watching a delegated task now shows a live status pill
  (working / done / failed), the instruction that started the task styled as its own card, and a
  gold "waiting for your approval" banner while the task is paused on you. Escape closes the panel.
- **Desktop UI now runs on the real API, not demo data (M7).** Deleted the hand-written demo
  namespaces and the scripted turn player; `workspaces`, `dashboard`, and the whole chat vertical
  (session reads + live turns + approvals + interrupt) now hit the generated SDK. Live turns stream
  over the real `chat-turn` / `global-root-turn` SSE via a typed `parseAs:'stream'` POST fed through
  a pure frame parser; approvals decide through the real API and the stream reflects the resolution.
  Global chat is one continuous conversation (`root.*`, no history list); workspace chat is `chat.*`.
  The workspace drawer's feature sections (skills, channels, schedules, knowledge, marketplace) read
  their real per-domain lists, each fetched only while its section is open. The composer's model
  picker is the real curated `CHAT_MODELS` allowlist, and the chosen model rides on every turn. The
  workspace files area browses real files lazily (one directory listing per folder, fetched on
  expand), and the editor reads and saves to real disk — truncated and binary files open read-only
  so a partial buffer can never overwrite the file. Contracts `ChatSessionResponse.workspaceId` is
  now nullable and `ChatToolCallResponse.toolInput`/`toolOutput` optional, matching the wire.
- **The demo data layer is fully removed** — `apps/local-web/src/demo/` no longer exists; the desktop
  UI runs entirely on the real API. (The Jarvis voice overlay stays a scripted animation until the
  voice engine lands — that is UI, not data.)

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
