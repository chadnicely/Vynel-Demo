# Module notes — desktop-ui (`apps/local-web` + `packages/ui` + `apps/desktop`)

> Chad's advice + the shape of this move, per `.claude/rules/build-discipline.md`.
> Full approved plan: `C:\Users\KLONE\.claude\plans\curious-wiggling-parasol.md` (2026-07-05).

## Chad's advice (this module's gaps + directives)

- **Fresh design, fresh code.** The v2 UI is NOT a port of the old repo's `apps/web`. The old repo
  is inventory/concept reference only — never file porting, never its decision docs. (The rebuild
  exists because the old base _felt_ unmaintainable; the UI carries the new foundation "for some
  years".)
- **Shell: Tauri v2 — LOCKED** (resolves vision §9's open call). Main window (frameless, custom
  titlebar) + a transparent always-on-top **Jarvis overlay** window. Old v1 shipped only a Tauri
  voice pill; the main UI ran in browser chrome — that's the "looks like a web view" problem v2
  fixes by wrapping the SPA in a native frameless window.
- **Desktop-app look**: the VS Code / Copilot-sessions screenshot is the design reference — dense
  dark desktop UI. Top-center nav: **Home | Chat | Workspace**.
  - **Home** — dashboard, live activity.
  - **Chat** — the global root chat (can send tasks to workspaces); hidden drawer with a single
    **Application** option (global settings).
  - **Workspace** — workspace picker → chat + same hidden drawer + a **files area** toggled by a
    menu icon; feature sections (Skills/Channels/Schedules/Knowledge/Marketplace…) live in the
    drawer, Customizations-style.
- **Activity tracking like Claude desktop**: the chat thread renders every tool call (Read/Write/
  Bash…) with status + collapsible input/output — live turns stream this in realtime.
- **Data layer mirrors letterman** (`E:\GROWTH HACKING V2\letterman`): `@tanstack/vue-query` over
  the typed namespaced SDK — per-domain key factories, one composable per operation, mutations
  invalidate the domain root, streaming stays OUTSIDE vue-query and reconciles by invalidation.
- **Demo-data-first**: the API is mid-build. Real SDK namespaces (skills/channels/schedules/
  marketplace/knowledge/approvals) are wired from day one; missing surfaces (workspaces, sessions,
  chat streaming) get hand-written demo namespaces **typed by `@vynel/contracts`** and attached to
  the same client object — swap = regen SDK + delete `src/demo/`, composables unchanged.
- **Voice is separate**: Jarvis wake + animations while talking/working, mutable like v1. Overlay
  UI ships first with a demo event simulator; the voice-engine module + sidecar wiring come later.

## Post-approval corrections (Chad, 2026-07-05 — supersede the plan file where they differ)

- **`apps/local-web`**, not `apps/web` — mirrors the `local-api` naming: this app always runs on
  the tenant's machine. `web` stays reserved for the future cloud-based web view (Phase 2).
- **`packages/ui` (`@vynel/ui`)** — the shared Vue component library + design tokens. `local-web`
  consumes it now; the future cloud `web` reuses it. Components are icon-agnostic (slots) and
  data-blind (props in, events out) — data wiring lives in the app.
- **Ports from env, never hardcoded** — `apps/local-web/env.ts` (Zod): `LOCAL_WEB_PORT`
  (default 8999) + `LOCAL_API_URL` (default `http://127.0.0.1:8998`), fed from the repo-root `.env`.
- **Approvals are notifications, not just chat cards** — an approval must be visible + decidable
  from ANY view (badge + actionable toast stack in the shell), and via OS notifications once the
  Tauri shell lands (M6). The global chat view is the single control surface where a non-technical
  user tracks every task — approvals never hide inside one thread.
- **No Tailwind** — the design system is CSS custom properties + scoped SFC styles only (one
  styling idiom, zero extra deps). Revisit only if utility sprawl appears.

## Known deviations (deliberate, with WHY)

- **Web tsconfigs use `moduleResolution: Bundler` + DOM libs** (`apps/local-web`, `packages/ui`) —
  `vue-tsc` needs bundler semantics for `.vue` modules. **Imports still follow the house `.js` rule**
  (Vite/esbuild and TS both substitute `.js → .ts`), so one import style holds repo-wide; `.vue`
  and `.css` imports keep their real extensions.
- **Typecheck in the gate** for the web packages is `vue-tsc --noEmit` (SFC-aware), not `tsc`.

## Deferral map (M7 — backend-dependent, deliberate)

- Swap demo→real when Slice-3 lands: workspaces CRUD routes, chat/session read routes, SSE turn
  streams (`streams/{chat-turn,global-root-turn}`) → delete `apps/local-web/src/demo/`.
- CORS on local-api for the packaged webview origin (dev uses the Vite `/api` proxy).
- Voice-engine module pull (name it `@vynel/voice-engine` — `@vynel/voice` is taken by the pure
  core) + Tauri sidecar supervision of api/worker/voice.
- Packaging: Node runtime as Tauri sidecar (`externalBin` + target-triple naming), installer,
  updater.

## Milestone ledger

- M1 Foundation — DONE (2026-07-05): `@vynel/ui` (tokens + PresenceDot/SegmentedTabs/IconButton/
  EmptyState) + `@vynel/local-web` (shell, 3 tabs, theme, env, SDK + vue-query provisioning).
  Verified live in browser (both themes, tab nav). Scoped gate green (typecheck + 13 tests);
  full-repo gate pending the concurrent user-scoped channels/schedules API session settling.
- M2 Data layer + M3 Chat experience — DONE (2026-07-05): demo seam (`src/demo/` — contracts-typed
  fixtures, in-memory store, hand-written `workspaces`/`chat` namespaces, scripted ChatTurnEvent
  player with approval-gate pause), letterman composables (key factories, one per op), the
  `active-turn-view` pure fold, `use-chat-turn` orchestrator (activeSessionId-bound), Global Chat
  end-to-end (sessions panel · thread · live turn · composer · Application drawer), the
  **ApprovalNotifier** shell layer polling the REAL approvals API + titlebar presence.
  **Rich tool cards (Chad's reference):** `tool-presenters` (Read/Write→highlighted code with line
  numbers, Edit→before/after diff, Bash→terminal, Grep/Glob→results, fallback→payload panes),
  `CodeBlock` (lazy shiki, dual-theme), `ToolCallList` grouping ("Read 2 files"). Reviewer CLEAN
  (M2/M3 pass); its should-fixes applied: `SessionScope` moved to
  `composables/chat/session-scope.ts` (out of the deletable demo folder), hardcoded approval
  `action-kind` dropped (contract gap noted below), live turn session-bound, MarkdownText XSS
  tests, `format-sdk-error` wired into the sessions panel. 43 tests / 12 files, lint+typecheck
  clean, full browser drive verified (stream → approval → complete → persist → refetch).
- M4 Workspace tab + M5 Home dashboard + voice demo — DONE (2026-07-05, Chad's "complete UI on
  demo, no real engagement" directive): workspace switcher (persisted `activeWorkspaceId`),
  per-workspace sessions + chat (same M3 components, workspace scope), files panel (recursive demo
  tree), the drawer's 7 feature sections (skills/channels/schedules/knowledge/marketplace demo
  lists typed by contracts; memory/agents honest empty states), Home dashboard (recent
  conversations across scopes · workspaces with manager personas · upcoming schedules · approvals
  note) over a demo `dashboard.getOverview()` aggregate (a plausible future real route), and the
  **Jarvis voice demo** — `VoiceOrb` (pure-CSS, 6 states, gold) driven by a scripted beat loop in
  `VoiceOverlayDemo` (mic button in the titlebar; mute; "engine plugs in later" note). Reviewer
  CLEAN; should-fixes applied (switcher outside-click close, `activeWorkspaceId` persistence
  tests, `workspace-sections.ts` extraction). 48 tests.
  **Sanctioned demo-import spots grew for this phase** (documented in-file):
  `WorkspaceSectionPanel` (section fixtures), `WorkspaceView` + `FilesPanel`/`FileTreeNode`
  (file trees), `HomeView` (global-root constant).
- **Continuous-first reshape (Chad's feedback, 2026-07-05 — THE chat UX contract):**
  - Chat (global AND workspace) opens straight into **the one continuous conversation** — no
    session list by default. Modeled on the REAL `GET /chat/continuing` contract
    (`ContinuingConversationResponse`); demo continuous threads are `visibility: 'hidden'`
    (unlisted), exactly like the real continuing-root segments.
  - Titlebar left: **menu icon** (no "vynel" wordmark) + **history toggle** (PanelLeft); on
    Workspace additionally **workspace switcher + "+"** (new topic conversation). Presence dot
    moved to the right cluster.
  - The **menu is a persistent PANEL** (Chad's follow-up), sitting just BEFORE the conversations
    panel: `[menu panel] [conversations panel] [canvas]`. Menu items render their views **on the
    canvas** (Chat included); the menu stays open while navigating. Global menu = Chat +
    Application; workspace menu = Chat + the 7 feature sections. State: `ui-store`
    `ChatShellState` per tab (`mainView`/`target`) + shared `isSessionListOpen` + `isMenuOpen`.
  - History panel: pinned **"Current conversation"** row returns to the continuous thread;
    history sessions below.
  - **Approval notifications: bottom-right**, decidable from any view (workspace context +
    plain-language description + Approve/Deny).
- **File editor + colorful tree (2026-07-05, while waiting on APIs):** clicking a file opens it
  ON THE CANVAS (`ChatMainView` gained `{kind:'file', filePath}`) in **direct edit mode** (VS
  Code semantics — Chad's call); **markdown gets a Code | Preview toggle**; dirty dot + Save/
  Discard appear on change. In-memory demo file store (`demo-file-store.ts`); the files API's
  read/write routes swap in behind the same two calls. Tree + editor icons are type-colored
  via `--file-*` tokens + `file-colors.ts` (folder tan is muted — vivid gold stays
  presence-only). **CodeMirror 6 landed** (lazy-loaded `CodeEditor.vue`, token-driven theme +
  lezer highlight map — the buffer itself is syntax-colored); the markdown **preview is
  colorful** via the shared `MarkdownText`: colored headings/links/inline-code, GitHub-style
  task checkboxes (gold when done), and shiki-highlighted fences through the extracted
  `ui/src/lib/shiki-highlighter.ts` (one highlighter for CodeBlock + markdown — chat messages
  get all of this too).
- M6 Desktop shell (Tauri window + overlay window hosting `VoiceOrb`) — pending; needs a
  Rust-toolchain session (first `cargo build` is long).

## Slice-3 contract asks (for the API session)

- `ChatTurnEvent` `approval-requested` should carry `actionKind` (the inline ApprovalCard can't
  classify danger without it — the card currently shows the generic headline).
- Generated `chat.listSessions` will be `(workspaceId|options)`-shaped vs the demo's `(scope)` —
  one-line queryFn adaptation in `use-session-list.ts` at swap time (recorded, expected).
- A dashboard aggregate read (`GET /dashboard/overview`-ish: recent sessions across scopes +
  upcoming schedules + workspaces) would serve Home in one query — the demo namespace models it.
- At swap time: gate `useSessionList` with `enabled` when no workspace is selected (the demo uses
  a harmless `workspaceId: "none"` sentinel that must not become a real request), and give
  dashboard "recent conversation" rows a session-preselect (needs cross-view selected-session
  state — today they open the right tab only).
