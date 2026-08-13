# Vynel Workspace redesign — 2026-08-14 (research + plan)

**Written 2026-08-14, before any implementation**, from: the freshly imported design pack
(`.claude-design/` @ `6f46e6c`, claude.ai design project `d2929de8-70c2-4aa9-aed6-22c0b7d5a7de`),
a full read of `Vynel Workspace.dc.html` + diffs of its five state siblings, a codebase recon of
`apps/local-web` / `packages/ui`, the `design/mission-control-prototype` worktree, and side-by-side
Playwright renders of the running app (web 18894, engine UI 18892) vs the served design canvases.
Screenshots: `.playwright-cli/shot-app-*.png`, `.playwright-cli/shot-design-{menu,tabs}.png`
(serve canvases any time: `node <scratchpad>/serve-design.js` → `localhost:18899`, it injects the
React UMD the claude.ai host normally provides).

**Chad's directive:** start from `Vynel Workspace.dc.html` — it needs the new theme plus one new
feature, the tabs/menu view. The chat surface is one shared component used from the global UI; we
patch it, not fork it. Research first, plan on disk, then implement.

---

## Finding 0 — this design is already half-built on a live branch

> **Provenance (Chad, 2026-08-14):** this branch is the **boss's work** — non-technical, driving
> AI sessions. Its *direction* is authoritative (it IS the design's target); its *code is
> unverified reference*. See "Settled: where this arc lives" below for the standing rule.

`design/mission-control-prototype` (worktree `.claude/worktrees/mission-control-prototype`, band
18900, **clean, last commit 2026-08-13**, 49 ahead / 104 behind main, 291 files ±56k vs main)
already contains:

- **The theme.** `packages/ui/src/styles/tokens.css` there is "THE SYSTEM IS NOCTURNE" — the raw
  Nocturne tokens **verbatim** (`--color-bg #161826`, accent `#9184d9`, ramps, spacing, radii
  4/8/14, ring shadows, Inter import) with the app's semantic aliases (`--bg-*`, `--ink-*`,
  `--hair`, `--gold`…) re-pointed at Nocturne values. Two-layer adapter = existing components
  inherit the look for free. (Naming debt: `--gold` is now violet — rename sweep deferred.)
- **The whole onboarding wizard**, with tests: `components/workspace/new-app-wizard/` — NewAppWizard
  + all 13 step components + `wizard-steps.ts` / `build-project-brief.ts` / `derive-stack.ts`.
  The new export's wizard canvas is unchanged (3-line diff) — that work is current.
- **Evolved shell + chat:** `AppShell.vue` +1284, `AppSidebar.vue` +747, `ThreadStream.vue` +733,
  `ComposerDock.vue` (new), `WorkspaceFactsRail.vue` (+616 — the right rail), MissionControlView +
  constellation scene, `project-groups-store.ts` (folders!), `use-workspace-progress/levels/
  lifecycle`, and commit `9d4e3b5` "one status, one colour on every surface".
- **Proof the canvases target this branch:** the design's mocked conversation literally cites
  commit `9d4e3b58` and "localhost:18894". The old export of the *same* design project sits at
  `prototype/mission-control/design/` in that worktree (workspace canvas: 770 lines vs today's
  1380). The Nocturne stylesheet between exports is **value-identical** (45 lines of comment
  churn) — so "new theme" means *new to the app*, not a retuned design system.

**What the branch does NOT have:** the tabs/menu nav toggle (`navMode` appears nowhere in its
shell/store), the new workspace-canvas chat lifecycle (collapse/grayscale done cards, working
pill + timer, inline comment, refs chips, handed-off card, queued pills), the priority flow, the
task hover/detail treatments, the state-hue treatments, folders drag-drop UI in the sidebar tree.
That — plus reconciling with main — is this arc.

## Finding 1 — current app on main (the patch surface)

- **Shell:** `AppShell.vue` grid `40px AppTitleBar / 40px AppTabStrip / 1fr body / 22px
  AppStatusBar`; custom HTML title bar (Tauri `decorations(false)`), tabs already exist as
  **pinned Global + workspace room tabs** (`AppTabStrip.vue`, `use-scope-tabs.ts`,
  `ui-store.ts:199-304`, persisted `vynel.tabs`, URL wins on boot). The design's "tabs mode" is an
  evolution of this strip (status chip, alert dot, DEVELOPMENT label, dimmed not-running tabs);
  the design's "menu mode" (sidebar tree + drill-in) is **new**.
- **Chat is the shared pair** — `components/chat/ThreadStream.vue` (804) + `AppComposer.vue` (215,
  wraps `@vynel/ui` ChatComposer), mounted by **four hosts**: GlobalChatView, WorkspaceView,
  SessionThreadView (×2 mounts), WorkspaceSidebarThread. Scope is host-resolved
  (`SessionScope = global | workspace`); patching the pair updates every surface — exactly Chad's
  "we can patch that".
- **Theme today:** near-black neutral (`tokens.css` on main: `--bg-shell/panel/raised`, gold =
  assistant presence only, native Segoe stack, lucide icons; `docs/desktop-shell-design-spec.md`
  is the prior thesis). Tailwind 4 CSS-first bridge in `apps/local-web/src/styles/app.css`
  (`@theme inline`) — token swap propagates through utilities automatically.
- **Workspace view:** canvas + opt-in FilesPanel/TasksPanel; **no persistent right rail on main**
  (the rail exists on the branch as WorkspaceFactsRail).

## Finding 2 — what the new workspace canvas specifies (inventory)

Layout `34px title bar / tab strip (tabs mode only) / 208px sidebar · 1fr chat · 272px rail`:

1. **Title bar:** Vynel mark · (tabs mode: "DEVELOPMENT" folder label) · **Tabs|Menu toggle** ·
   connection dots (GitHub/Vercel/Claude/Grok, on = accent ring + glow) · window controls.
2. **Nav, two modes** (`navMode: 'menu' | 'tabs'`, a persisted user preference):
   - *menu:* no strip; sidebar shows the **workspace tree** — folder header (`~/DEVELOPMENT`,
     new-folder/new-app buttons), user folders (drag-drop rows in, dashed drop target), active
     rows (caret → drill-in, chip: spinner=running / moon=off, `4/13` progress, waiting mark dot),
     collapsible **NOT RUNNING** group; row hover → fixed **stack card** (front/back/db/model/
     folder/repo/local/shared). Drill-in: back row → app header card → sections (Chat, Sessions n,
     Agents, Skills, Rules, Apps, Memory, Knowledge, Settings).
   - *tabs:* strip under the title bar — one tab per app (chip + name + pulsing alert dot),
     dimmed not-running, `+`; sidebar is permanently drilled (no back row).
3. **Chat thread (the ThreadStream patch):** every turn is a **task card** —
   - live: accent left spine (animated), "VYNEL WORKING · timer" pill, Vynel reply block with
     "thinking · timer" chip + step label;
   - done: collapsed one-liner + "read more", 30% opacity + grayscale, wake on hover/expand;
     reply lead always visible, blocks expand (p/li with bold/`code`/@mention part styling);
   - inline **comment** ("Reply to Vynel") textarea on any card → queued follow-up;
   - **refs chips** (`@Letterman · read only`), **HANDED OFF** card (subagent fork notice),
     cross-project turns (Cross Project canvas) with marching-ants live border.
4. **Composer dock:** QUEUED pill row (dismissible) · input "Create a task... type @ to pull in
   another project" with **@-mention dropdown** (other workspaces + state) · actions **Push Local /
   Send Git / Resort Back** · picks **Opus 4.8 / Auto / High** · git-branch, mic, send · three
   toggles **Clarify before build / Auto buildout / Rewrite with AI**.
5. **Right rail (272px):** live-session card (kicker Vynel working / Waiting on you / Hit a
   problem / All done / Not running; title, "Task n · building now", glowing progress bar, "4 of
   12 steps completed") · **In the queue N / Completed N** pill tabs · task list (`6. Somewhere to
   keep things · 8 steps`) with hover **task card** (status, steps/starts/estimate or completed/
   took/approved-by, step names) and selected → **Make priority** → modal (finish-first vs
   abort-and-start) · **OPEN IT**: Open locally (browser / desktop app / ngrok share), Open
   repository, **Abort all tasks** (inline confirm).
6. **Sibling canvases:** Task Detail (per-task step list with durations, expandable outputs,
   files), Completed (adds **new-task modal** with AI rewrite), Needs Input / Problem (state
   treatments), Cross Project (@-refs conversation).

## Finding 3 — the lifecycles

- **Workspace/app:** `off (moon) → running (spinner, n/m) → waiting marks`: requires-help,
  hit-a-problem, completed. Hue system (needs settling, see decisions): working = accent blurple;
  needs-input = **#38b6ff** treatment but **#e08243 orange** sidebar mark; problem = #f2564b
  (mark #d3564f); completed = **oklch(0.70 0.105 158)** in the Completed canvas but #4fa97a in the
  base and re-tinted per-fork elsewhere. Branch precedent: `9d4e3b5` "one status, one colour on
  every surface" — extend that status module, don't invent a second home.
- **Task/session:** `queued → live → done`, plus `after` ("later — after the first version").
  Steps inside a task: `queued → running → done` with durations (Task Detail canvas).
- **Message card:** sent → live (spine + timer) → done (collapse + grayscale) → reply expand /
  comment → queued follow-up.
- **Nav:** menu ↔ tabs is a *view preference over the same tab state* — `ui-store` ShellTab list
  stays the source of truth; menu mode renders it as a tree, tabs mode as the strip. Drill-in in
  menu mode ≙ active tab in tabs mode.

## Finding 4 — design ↔ engine gaps (mock data the canvas assumes)

Have today: workspaces, sessions, tasks (+steps?), activity stream, personas, tabs, theme toggle.
On the branch: folders (`project-groups-store`), workspace progress/levels, facts rail data.
**Missing/new:** connections status row; Push Local / Send Git / Resort Back semantics; ngrok
share links; per-task estimates; handed-off (subagent) cards in thread data; cross-project @refs
with read-only/propose scopes; abort-all; the three composer toggles as engine flags; per-step
durations/outputs surfaced to UI. → Arcs below ship UI on real data where it exists and stub
*visibly* where it doesn't; each stub gets a follow-up line in this file rather than silent mock.

---

## Settled: where this arc lives (Chad, 2026-08-14)

**Main is home. The prototype worktree is reference, not foundation.** The branch was built by
Chad's boss — non-technical, driving AI sessions — so it shows the intended product faithfully,
but its code carries no engineering guarantee. Standing rules for this arc:

- **UI intent transfers; code transfers only after verification.** Prototype files may be read
  for shape and ideas. Anything actually lifted is verified line-by-line against the design pack
  (`.claude-design/` is the canonical design source) and against the engine's real contracts
  before it lands on main. Nothing merges wholesale.
- **The boss's API/label/naming changes are suspect by default and are never adopted on trust.**
  Any engine-facing surface the UI needs (status vocabulary, folders, task steps, priority,
  abort-all, composer flags) is designed and built **fresh on main** under the project discipline
  — vertical slice, outbox co-commit, typed errors, tests, the gate — *informed by* the branch,
  never copied from it.
- The worktree stays untouched as reference material; we do not build on it, merge it, or fix it.

## Arcs

**Arc 0 — kickoff + reference protocol.** No merge. Write
`docs/module-notes/workspace-redesign.md` (Chad's advice + this plan's constraints). Catalogue
the prototype files we consult as reference — `tokens.css`, `WorkspaceFactsRail.vue`,
`ComposerDock.vue`, `project-groups-store.ts`, `new-app-wizard/` — each marked **UNVERIFIED
REFERENCE**. Reviews happen on main's root band (web 18894).

**Arc 1 — theme.** Author main's `tokens.css` ourselves from the canonical
`.claude-design/project/_ds/nocturne-*/styles.css`: raw Nocturne tokens verbatim + the app's
semantic aliases (`--bg-*`, `--ink-*`, `--hair`, presence) mapped onto them — the boss's
two-layer file validates the *approach* and serves as a cross-check diff, not as the source.
Port the new export's component nuances (fading rules, neutral scrollbars). Sweep the Tailwind
bridge + hex stragglers. Fonts/icons per decisions below. Ship = whole app wears Nocturne on
main; Chad eyeballs at 18894.

**Arc 2 — tabs/menu view (the new feature).** `navMode` in `ui-store` (persisted alongside
`vynel.tabs`), Tabs|Menu toggle in AppTitleBar; tabs mode = evolve AppTabStrip (status chip,
pulsing alert dot, dimmed off-rows, folder label in title bar); menu mode = collapse the strip
row, render the workspace tree in AppSidebar (folders + drag-drop, active/NOT RUNNING groups,
hover stack card, drill-in reusing the existing section menu). Same ShellTab state under both
modes. **Folder persistence is a new engine slice built fresh on main** (workspace group as a
loose ref, outbox events, tests — the boss's `project-groups-store` is reference only).

**Arc 3 — patch the shared chat pair.** ThreadStream: task-card chrome (live spine + working
pill/timer, done collapse/grayscale/read-more, reply-lead + block expand, inline comment, refs
chips, handed-off card) behind the existing props seam so all four hosts keep working — adopt
host-by-host starting with WorkspaceView, GlobalChatView last. Composer dock: queued pills,
@-mention rows, actions/picks/toggles — wire the ones with real engine backing; visible stubs
for the rest, each logged as a follow-up in this file.

**Arc 4 — right rail.** Build the workspace rail **on main** (live-session card, queue/completed
pill tabs, task list + hover card, make-priority modal, OPEN IT block with open-locally dropdown
from real app/port data, repository link, abort-all wired to a real engine stop). The boss's
`WorkspaceFactsRail.vue` is layout reference, not source.

**Arc 5 — states + siblings.** One status vocabulary + hue system end-to-end, designed on main
against what the engine actually emits (the boss's `9d4e3b5` "one status, one colour" is the
idea precedent). Then Needs Input / Problem / Completed treatments, Task Detail step view,
new-task modal, cross-project turn rendering.

Every arc: gate green + `code-reviewer` + Chad eyeballs the band before the next.

## Settled decisions (Chad, 2026-08-14, via AskUserQuestion)

1. **Branch strategy:** main is home; the boss's prototype worktree is unverified reference. UI
   intent transfers after verification; API/label changes never transfer; new functionality is
   built fresh under the project discipline.
2. **Icons: swap to Phosphor**, as its own commit in Arc 1. (Verified first per Chad's ask: the
   boss's worktree did NOT migrate icons — still lucide-vue-next in 84 files, zero Phosphor —
   so the sweep conflicts with nothing.)
3. **Needs-input hue: blue `#38b6ff`** everywhere (the orange `#e08243` sidebar mark loses).
4. **Completed hue: `oklch(0.70 0.105 158)`** (the Completed canvas's settled green).
5. **Fonts: Inter, vendored** — bundle the font files with the app; no Google CDN at boot.

## Design-internal inconsistencies (resolve during Arc 5, tracked here)

- The three state forks each re-tinted the shared `completed` mark (#38b6ff / #f2564b / green) —
  artifacts of fork-editing, not intent; the per-state hue map in Finding 3 is the readable intent.
- Base canvas model picker says "Opus 4.8"; Onboarding Wizard shows "Opus 5". Cosmetic.
- `taskCard.status` in the Problem canvas says "Completed" with red styling — fork artifact.
