# Desktop shell — Phase 1: current-UI inventory

*Read of `apps/local-web` + the shared `@vynel/ui` library. Research only — no code changed.*

---

## The one-paragraph read

There is already a **shipped, substantial desktop UI** here — not a blank slate. `apps/local-web`
is a Vue 3 (`<script setup>` + Composition API) SPA with **57 components**, a **17-component shared
`@vynel/ui` library**, vue-router, Pinia, and vue-query, wrapped by a Tauri v2 shell for the real
desktop app. It already has an app shell (a 40px title bar + body grid), a persistent left **menu
panel**, toggleable history/files side panels, dark/light theming, and a coherent design language.
**Two facts collide with the brief, though, and both gate Phase 2:** (1) **the project does not use
Tailwind at all** — styling is a bespoke CSS-custom-property token system (`packages/ui/src/styles/
tokens.css`, explicitly "the one visual contract for every Vynel surface") consumed via `<style
scoped>` vanilla CSS in every component; and (2) **the shell is a deliberate 3-tab, Claude-branded,
anti-chrome design** (a locked UX decision), *not* a File/Edit/View menu-bar app, and **its panels
are fixed-width toggles with no drag-to-resize and no persisted sizes.** So the real Phase-2/3 work
isn't "build a desktop shell from scratch" — it's "add the genuinely-missing pieces (resizable
panes, a real menu/command surface, reusable overlay primitives) into the existing shell and token
system." What styling system and how far to push the shell are the two calls to make before we design.

---

## Stack & styling — the facts

| Concern | Reality |
|---|---|
| Framework | Vue 3, `<script setup lang="ts">`, Composition API only |
| Build | Vite 5, `@vitejs/plugin-vue`; `/api` + `/voice` dev proxies |
| Routing | `vue-router` — 4 routes: `home`, `chat`, `workspace`, `display-dock` (bare) |
| State | Pinia (`ui-store`, `activity-store`, `live-sessions-store`, `session-viewer-store`, `onboarding-store`) + `@tanstack/vue-query` for server state |
| **Styling** | **NOT Tailwind.** CSS custom properties in `@vynel/ui/styles/tokens.css` + per-component `<style scoped>` vanilla CSS. No `tailwind.config`, no utility classes, no `tailwind` dependency anywhere. |
| Icons | `lucide-vue-next` in the app; **inline SVG** in `@vynel/ui` (deliberately icon-library-free) |
| Editor | CodeMirror 6 (lazy-loaded) |
| Desktop wrap | Tauri v2 — title bar carries `data-tauri-drag-region`; **real OS window controls**, not simulated |
| Persistence | `localStorage`: `vynel.theme`, `vynel.active-workspace` only. **No panel sizes persisted.** |

### The token system (what a design system already looks like here)
`tokens.css` defines, with a `[data-theme="light"]` override for every value:
- **Surfaces** `--bg-shell / --bg-panel / --bg-raised / --bg-overlay` (a 3-step elevation ladder)
- **Ink** `--ink-1 / --ink-2 / --ink-3`  · **Hairlines** `--hair / --hair-strong` · **Rows** `--row-hover / --row-active`
- **Accent** `--gold*` (reserved: assistant *presence* only) · **Identity** `--claude-mark*` (Claude's coral spark)
- **Status** `--ok / --danger / --info` · **File-type** `--file-*` · **Workspace accents** `--ws-1..6` (hash-assigned per workspace)
- **Shape** `--radius-s/m/l` · **Type** `--font-ui / --font-display / --font-mono` (Segoe UI Variable system stack)
- **Elevation** `--shadow-raised / --shadow-overlay` · **Motion** `--ease-out`, `--t-fast (120ms) / --t-slow (240ms)`

This is already close to the "design system as tokens" the brief asks for — just expressed as CSS
variables, not a Tailwind theme.

---

## Component tree

```
apps/local-web/src/
├── App.vue ······················ shell root: grid(40px titlebar / 1fr body); routes bare dock,
│                                   swaps in OnboardingWizard on first-launch 412, else the shell
├── views/
│   ├── HomeView.vue ·············· dashboard (greeting, recent-conversations/workspaces/coming-up/approvals cards)
│   ├── GlobalChatView.vue ········ global "one brain" chat; hosts MenuPanel + SessionsPanel + canvas (chat|section)
│   ├── WorkspaceView.vue ········· per-workspace room; MenuPanel + SessionsPanel + FilesPanel + canvas
│   └── DisplayDockView.vue ······ bare floating voice window (no shell)
├── components/
│   ├── shell/
│   │   ├── TitleBar.vue ·········· 40px top bar: menu/history toggles · WorkspaceSwitcher · SegmentedTabs (Home/Chat/Workspace) · presence · voice · theme
│   │   ├── MenuPanel.vue ········· persistent 220px left list of menu items (renders views on canvas)
│   │   └── ApprovalNotifier.vue ·· global corner approval popups
│   ├── chat/  ···················· AppComposer · GlobalWelcomeHero · LiveTurn · SessionsPanel(280px) · ThreadStream
│   ├── workspace/ ················ FilesPanel(280px) · FileTreeNode(recursive) · FileEditorView · CodeEditor · WorkspaceSwitcher · WorkspaceSectionPanel · WorkspaceWelcomeHero · CreateWorkspaceDialog
│   ├── sections/ ················· 8 feature Sections (Account/Agents/Channels/Knowledge/Marketplace/Memory/Notebook/Schedules) + 6 Dialogs + Cards/Fields/Rows
│   ├── onboarding/ ··············· full-window wizard shell + 6 step screens + 7 steps/
│   ├── session-viewer/
│   │   └── SessionViewerPanel.vue  floating right overlay: live trace of a delegated task
│   └── voice/  ··················· VoiceOverlay (full-screen) · VoiceStage (presentation)
├── composables/ ················· ~20 feature folders of vue-query hooks (chat, approvals, workspaces, hub, …)
├── stores/ ······················ ui · activity · live-sessions · session-viewer · onboarding
└── styles/app.css ··············· base reset, scrollbars, focus ring, ::selection — imports tokens.css

packages/ui/src/  (shared, reusable-by-design)
├── components/ ·················· 17 components (see table)
├── lib/ ························· shiki-highlighter · workspace-color (hash→accent) · workspace-monogram
├── tool-cards/ ·················· group-tool-calls · tool-presenters (raw tool call → presentation)
└── styles/tokens.css ············ THE design tokens
```

---

## Reusable vs. one-off (the split)

**`@vynel/ui` = the reusable layer** (shared design system, consumed by the app and the future cloud web view):

| Component | What it is | Reuse class |
|---|---|---|
| IconButton | 28px chrome icon button; `label`→native `title`+`aria-label` (**the only tooltip in the app**) | primitive |
| EmptyState | title + hint + icon/action slots | primitive |
| SegmentedTabs | controlled tab bar (v-model) — used for the shell's Home/Chat/Workspace | primitive |
| SelectChip | inline dropdown chip w/ click-outside menu — **the only popover pattern in `@vynel/ui`** | primitive |
| PresenceDot | gold idle/live/attention dot | primitive |
| CodeBlock / MarkdownText | Shiki code + markdown-it/DOMPurify renderer | primitive |
| ClaudeMark | SVG identity starburst | primitive (brand) |
| ChatComposer | the full chat input (textarea, model/mode chips, mic, attach) | domain |
| MessageRow · LiveTurn* · ThreadStream* | transcript rendering | domain |
| ApprovalCard · AttachmentChips · ThinkingBlock · ToolCallCard/Detail/List · VoiceOrb | trust/tool/voice widgets | domain |

**`apps/local-web/components` = the one-off / feature layer** — Sections (8), Dialogs (6), the onboarding
wizard + steps, and the shell pieces. These are feature-specific and not meant to be reused elsewhere.

*(\*LiveTurn/ThreadStream live in the app's `chat/` folder, not `@vynel/ui`.)*

---

## Layout & panel model (what the brief calls "resizable panels")

Both chat views are a **flexbox row**: `[MenuPanel?] [SessionsPanel?] [canvas flex:1] [FilesPanel?]`.
Every side panel is **fixed-width and `flex:none`**, toggled on/off — **none are resizable**:

| Panel | Width | Toggle | Resizable? | Size persisted? |
|---|---|---|---|---|
| Title bar (App.vue) | 40px row | always | — | — |
| MenuPanel | **220px** | `ui.isMenuOpen` | ❌ | ❌ |
| SessionsPanel (history) | **280px** | `ui.isSessionListOpen` | ❌ | ❌ |
| FilesPanel (workspace) | **280px** | local `isFilesPanelOpen` | ❌ | ❌ |
| SessionViewerPanel | floating `clamp(460px,48vw,92vw)` | store-driven | ❌ | ❌ |

Evidence is direct from the layout CSS: `.chat-view/.workspace-view > :not(.canvas){flex:none}`,
`MenuPanel{width:220px}`, `SessionsPanel{width:280px}`, `FilesPanel{width:280px}`. There are **no
`pointerdown`/`mousedown`/`clientX` splitter handlers anywhere** in the app. So "resizable panels
with sizes persisted across reloads" is a **genuine gap** — a clean, well-scoped Phase-3 addition.

---

## Inconsistencies · duplication · gaps

**Duplication (real, worth extracting):**
- **No shared modal/overlay base.** 6+ dialogs (`AddKnowledge/AddMemory/ConnectChannel/CreateSchedule/
  ReadBook/WriteBook` + `CreateWorkspaceDialog`) each re-implement the *same* `<Teleport to="body">`
  + `.dialog-backdrop{position:fixed;inset:0;...}` + Escape handler + `.ghost`/`.primary` footer
  buttons. A `Modal`/`Dialog` primitive would delete a lot of copy-paste.
- **"Arm-then-confirm" destructive idiom** is hand-rolled independently in `AccountDeviceRow`,
  `ChannelsSection`, `MarketplaceSection/Card`, `NotebookSection` — comments literally cross-reference
  each other. Candidate for a `ConfirmButton`/composable.
- **Two bespoke dropdown mechanisms** (`WorkspaceSwitcher` absolute popover + manual click-outside;
  `SelectChip`'s internal menu) with duplicated open/close/Escape/click-outside logic and no shared base.

**Minor inconsistencies:**
- Primary-button text color hardcoded `#14171c` in several dialogs instead of a token.
- `SessionViewerPanel` uses a responsive `clamp()` width while the other panels are hard pixel widths.

**Gaps vs. the brief's target components:**

| Brief asks for | Exists today? |
|---|---|
| Simulated title bar (icon + title + window controls) | **Partial** — a title bar exists but as a *tab bar* with real Tauri drag/controls; no app-icon+title, no simulated min/max/close |
| Menu bar with dropdown menus (File/Edit/View) | **No** — there's a persistent left *menu panel* + a hamburger toggle, no menu-bar dropdowns |
| Resizable split panes (draggable dividers) | **No** — fixed-width toggle panels only |
| Command palette | **No** |
| Context menus (right-click) | **No** |
| Tooltips | **Native `title` only** (IconButton) — no JS tooltip primitive |
| Dropdown menu primitive | **No shared one** — two bespoke variants |

---

## Decisions that gate Phase 2 (recommendations)

1. **Styling — Tailwind (as briefed) vs. the shipped token system?** The project has no Tailwind and
   a deliberate CSS-variable design system that is "the one visual contract." Adding Tailwind bolts a
   second paradigm onto shipped code and cuts against the one-home rule. **Recommendation: express the
   Phase-2 design system as extensions to `tokens.css` (the existing tokens), not Tailwind** — unless
   the goal is an explicit, separately-scoped migration off the bespoke system.
2. **Shell scope — augment the existing 3-tab shell, or redesign toward a File/Edit/View app?** The
   3-tab, anti-chrome, Claude-branded shell is a locked/shipped decision. Resizable panes + a
   command/menu surface + reusable overlay primitives are real gaps that *fit* it. **Recommendation:
   add these into the existing shell + tokens, rather than replace the paradigm.**
3. **Target — browser-simulated chrome vs. real Tauri window?** The brief assumes localhost/browser
   with simulated window controls; the app ships in Tauri with real OS controls (`data-tauri-drag-region`).
   Both are true (Vite dev runs in the browser; Tauri wraps it for release). **Need to know which
   Phase 2 designs for** — a browser-primary simulated titlebar (min/max/close buttons drawn in-app)
   changes the titlebar spec.
