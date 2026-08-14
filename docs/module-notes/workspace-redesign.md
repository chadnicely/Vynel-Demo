# Workspace redesign — module notes

**The spec is `.claude/plan/workspace-redesign.md`** (research, canvas inventory, lifecycles,
arcs, settled decisions). This note carries the per-move advice the build discipline asks for.

## Chad's frame (2026-08-14)

- Start from `Vynel Workspace.dc.html`: the new theme plus the tabs/menu view; the chat surface
  is the shared ThreadStream/AppComposer pair — patch it, don't fork it.
- The `design/mission-control-prototype` worktree is the **boss's** AI-built prototype:
  UI reference only, code unverified, API/label changes never adopted. Anything engine-facing is
  built fresh on main under the project discipline.

## Landed

- **Arc 1a** (`db30e8b`): Nocturne tokens two-layer + vendored Inter + canvas inks.
- **Arc 1b** (`902cd0d`): lucide → Phosphor across local-web (aliased imports; catalog names are
  contracts data and stayed).
- **Arc 2a**: `navMode` (`tabs`/`menu`, persisted `vynel.nav-mode`, tabs = default) + title-bar
  Tabs|Menu segment + presence-aware strip (spinner chip / needs-input dot) + menu mode's
  `WorkspaceTree` sidebar root with drill-in/back over the SAME ShellTab state
  (`use-workspace-presence` derives working/attention/idle from server turns + pending
  approvals/asks — both workspace-scoped).

- **Arc 2b**: the `workspace_groups` engine slice — schema in the db kernel (workspaces is a
  hub), migration `0039_workspace_groups` (CREATE TABLE + loose `workspaces.group_id`), repos,
  five ops (create/list/rename/delete/set — created/deleted outbox pair, rename/move event-less
  per the D14 selectivity precedent), `/workspaces/groups` routes (+ `PUT /:id/group`),
  regenerated SDK (5 methods) + MCP (`list_workspace_groups` read-only), and the tree UI:
  folders with drag-drop, inline rename via context menu, root-zone detach.

## Arc 5b — LANDED (2026-08-14, Kafi's session)

Everything in the worklist below shipped in one move (typecheck 104/104, 1217 targeted tests,
parity green, live-verified at 18894 with real set-status calls):

- **The status vocabulary, end-to-end.** Engine: `workspaces.status/statusNote/statusSetAt`
  (migration `0041_workspace_status`), `setWorkspaceStatus` op (+`workspace.status-set` outbox),
  `PUT /workspaces/:id/status` [x-mcp `set_workspace_status` — the tool teaches the protocol:
  completed before finishing when every task is done · problem when stuck · needs_input for
  conclusions; approvals/asks are detected], `GET /workspaces/statuses` (app-layer composed read:
  set state + latest turn envelope + task rollup), `countTasksByWorkspace` in @vynel/tasks, and
  turn OUTCOME threading (`endedReason: 'failed'` on terminal `session-errored`/throw/timeout/
  settle-failure across EVERY workspace-scoped producer — the two interactive streams, schedule
  fires, and the three delegation runners; a user Stop stays a clean 'ended'; `turn-ended`
  events carry `outcome`). Set states are FACTS superseded by any turn that starts later — no
  clearing writes.
- **One derivation, one colour**: `use-workspace-status.ts` is the single effective-status home
  (problem → needs_input → running → completed → not_running; detection: failed/orphaned latest
  turn = problem, pending approval/ask = needs_input; the assistant's note surfaces only when
  the SET state is what actually shows); `use-workspace-presence` is DELETED — every surface
  reads the status composable directly. Hues ride the tokens (--needs-input/--danger/--ok) via
  data-status selectors on every surface, hardcoded canvas hexes swept (gate-3 review catch).
- **Conversation cards**: ThreadStream groups ask + reply into ONE card (the canvas's chat
  shape); folded exchanges are one dim grayscale strip with "read more"; the live card keeps the
  spine + working pill; the state canvases' pills/spines re-tint the live/latest card per status.
  MessageRow: user bubble retired (the card is the container), 14px/500 ask lines.
- **Shell parity**: browser-style tab strip inside the canvas column (state chips + pulsing
  status dots + parked dim; close/retarget/color kept as hover affordances), workspace tree rows
  with state chips + `done/total` progress + status marks + the NOT RUNNING group (parked =
  quiet AND nothing open; foldered rows stay in their folder — membership clarity beats the
  mock's split; group defaults OPEN so nothing vanishes day one), drilled sidebar header card
  with the live status line, chat-column header with the status badge, title bar on the chrome
  ground with the accent diamonds mark, rail kickers/tints/task-rollup per status.

Deferred within 5b (still deliberate): user avatar images (initials only);
per-done-card step labels (no per-turn step history); composer actions/toggles row; connection
dots; the tree header's `~/DEVELOPMENT` path.

## Arc 5b parity sweep (2026-08-14, Kafi's session) — the worklist

Side-by-side render (design served at 18899 via scratchpad serve-design.js + React UMD; app at
18894) + full read of all six canvases. The component-level diffs to close, in build order:

1. **Status vocabulary (engine)** — one per-workspace status: `running | needs_input | problem |
   completed | not_running`. Claude SETS problem/completed/needs-input (conclusion) via MCP;
   detection adds: pending approval/ask → needs_input, errored latest turn → problem, in-flight
   turn → running. A set state is superseded by any turn that STARTS after it. Progress per
   workspace = done tasks / total tasks (the canvases' `4/13`).
2. **Chat cards** — one card per conversation exchange (user ask + the reply IN ONE CARD; today
   the reply's turn renders as its own card). Card header = the asking row (avatar + name +
   time); reply section under a hairline inside the card; done cards fold to one-line +
   "read more" at 0.3 opacity grayscale(1); live card = accent-900 ground + spine + working pill
   (exists); state pills re-tint by workspace status (needs-input #38b6ff "waiting" · problem
   #f2564b "stuck" · completed oklch(0.70 0.105 158) "done in").
3. **Sidebar tree** — rows grow the canvas chrome: 16px STATE chip (spinner=running · moon=off),
   `n/m` task progress, status mark dot (status hue), NOT RUNNING collapsible group. Identity
   monogram/accent stays only where no state chip applies (active row highlight keeps accent).
4. **Drill-in sidebar** — app header card above the sections (initials chip + name + live status
   line from the same status source); back row label unchanged (Workspaces).
5. **Tab strip** — browser-style tabs on the chrome ground: top-radius tabs, active = canvas bg +
   2px accent bottom edge, 16px state chip, pulsing status dot, off-tabs dimmed. Close/retarget/
   color affordances stay (real features; hover-reveal).
6. **Title bar + chrome grounds** — title bar + strip on `--bg-chrome` (#12141f), accent
   diamonds-four mark.
7. **Rail** — kicker vocabulary per status (Vynel working / Waiting on you / Hit a problem /
   All tasks done / Not running) + live-card tint per status; task rows numbered `N.`; end-state
   progress line = task counts.
8. **Chat column header** — 40px header: workspace name + status tag ("Task n of m" from task
   counts / "Waiting on your answer" / "Stopped on an error" / "All n tasks done").

Deliberately NOT ported (logged, honest-data rule): connection dots (no connections engine),
composer actions/toggles row (Push Local / Send Git / Resort Back / Clarify / Auto buildout /
Rewrite — no engine semantics), per-done-card "N of M steps" labels (per-turn step history isn't
stored), priority flow + per-task estimates (no engine data), user avatar image (initials only),
"Create a task..." placeholder (persona placeholder is the real contract).

## Known deferrals (deliberate, not forgotten)

- **NOT RUNNING group + n/m progress** in the tree → needs the long-lived workspace lifecycle
  (build-session state), which main doesn't carry yet — Arc 5 territory. Presence today is the
  honest signal set: in-flight turns + pending approvals/asks.
- **Hover stack card** (front/back/db/model/folder/repo/local/shared) → with the rail arc; same
  facts source.
- **Problem state** (red) → no error signal per workspace on main yet; lands with the status
  vocabulary (Arc 5, one status one colour).
- **Menu mode can't close tabs** (the tree presents workspaces, not tabs) — visited rooms
  accumulate as strip tabs that surface on flip-back. Harmless; a close affordance joins a later
  arc if menu-heavy use shows the strip crowding. Same family: `toggle-sidebar` in menu mode
  hides the only nav surface (recoverable via the title-bar segment) — revisit in 2b. The
  title-bar presence dot counts approvals only while per-scope presence adds asks — fold asks
  into the title bar as one policy decision later.

## Pixel-parity diff — measured (2026-08-15, Kafi's session)

Method: design served at 18899 (`serve-design-canvases-recipe`), app at 18894, **both viewports
1600×1000 with the rail open** so the canvas column reads 1120px in each — the earlier pass
measured the app with the rail shut, which offset every chat width by 272px. Numbers below are
`getComputedStyle` + `getBoundingClientRect`, design ⇒ app.

Nocturne tokens themselves are already verbatim in `tokens.css`; every delta is a **usage-site**
choice, not a palette drift. Same for the type scale (`--text-2xs` 10.496px ≈ canvas 10.5px,
`--text-xs` 11.504px ≈ 11.5px, `--text-sm` 12.5px, `--text-base` 13.5px) — the drift is picking
the wrong step, not the step's value.

### Systematic (fix once, sweep everywhere)

- **`font-semibold` on micro-labels.** The canvas is `font-weight: 400` everywhere and lets
  `letter-spacing` do the work. We render `fw=600` on NOT RUNNING, the group headers, every count
  span, the back row, and the `KL` monogram.
- **Sidebar container padding.** Canvas: the `<nav>` itself carries `padding: var(--space-6)
  var(--space-3)` (16.8px / 8.4px), so *every* child — NOT RUNNING and the account foot included —
  is 190px and inset. Ours pads per-child (`px-2`) and lets NOT RUNNING + the account row go
  full-bleed (207px).
- **Sidebar base font.** `<nav>` inherits 13.5px; the canvas column is 12.5px.

### 1 · Workspace tree (menu mode)

| | canvas | app |
|---|---|---|
| row grid | `12px 16px minmax(0,1fr) auto`, gap 8px → name at **x=64** | 24px caret button + flex → name at **x=56** |
| row padding | `6px 11.2px 6px 10px` | 0 on wrapper, `0 8px 0 0` on the label button |
| caret icon | 10px | 11px |
| folder row | 12px, `--color-neutral-300`, pad `5px 11.2px 5px 7px` | 11.5px (`text-xs`), `neutral-400` |
| folder icon | 13px `--color-neutral-500` | 13px `ink-3` (= neutral-600) |
| foldered child row | `min-height: 30px`, pad-left **24px** | 32px, `pl-3` (12px) on the `<ul>` |
| NOT RUNNING | 190px inset, pad `7px 11.2px 5px 10px`, **fw400** | 207px full-bleed, pad `4px 16px`, fw600 |
| off-state chip | bg `--color-neutral-900` | same token — ✓ |
| account foot | pad `11.2px 11.2px 4px`, chip 19px fw400, name inherits `neutral-400`, `· Max` suffix 11px | pad `8px 12px`, chip 20px fw600, name `ink-1`, no plan suffix |
| header | `DEVELOPMENT` 12.5px `neutral-200` + `~/DEVELOPMENT` 10px `neutral-600` + folder-plus 13px + plus 12px, all `neutral-500` | label-less; two icon buttons at `ink-3`, right-aligned |

Vynel-only by design (canvas has no global scope): the pinned **Global** row. Its placement
relative to the folder header is an open call.

### 2 · Chat view

| | canvas | app |
|---|---|---|
| thread content | **full-bleed** — 1075 of 1120 (22.4px gutters) | 920px centred (`max-width: 920px`, 100px gutters) |
| composer | full-bleed 1075px | 968px centred (76px gutters) |
| folded card border | top/right/bottom at `divider x 55%`; the **LEFT edge transparent** | all four sides at `divider x 55%` |
| folded card box | pad `11px 22px 12px`, gap 8px, radius 8px | ✓ identical |
| author line | 20px round avatar + name 12px fw600 + 1×10px divider + time 11px, all **left** | name left, time pushed to the **right** edge |
| header title | 13.5px **fw400** | 13.5px fw500 |
| header badge | `.tag.tag-neutral` — pad `3px 10px`, radius **6px**, bg `neutral-800`, ink `neutral-100`, fw400 | pad `2px 9px`, radius **999px**, status-tinted, fw500 |
| header icons | three, 13px, gap 14px, `neutral-600` | one 28×28 icon button |
| header padding | `0 22.4px` | `0 22px 0 24px` |
| live card | bg `accent-900`, border-left 2px accent, margin-top 20px, pad `14px 22px 18px`, gap 14px | ✓ shape matches (hue is status-driven, not a delta) |
| composer box | pad `14px 16px`, radius 8px, input 13.5px, pickers **outside/below** | pad `10px 12px 8px`, pickers **inside** |

### 3 · Drilled section menu

| | canvas | app |
|---|---|---|
| shape | **flat list, per-row counts** on the right (10.5px `neutral-600`) | grouped under TOOLKIT / UTILS / CONTEXT / CONNECTIONS, no counts |
| section row | 35px, pad `8px 11.2px`, gap 12px, 12.5px, icon 13px | 30px, pad `5px 10px`, gap 12px — type/icon ✓ |
| list gap | 2px | 1px (`gap-px`) |
| back row | `← DEVELOPMENT` (the folder), 11.5px, **not uppercase**, `neutral-500`, pad `5px 11.2px` | `← WORKSPACES`, 10.5px uppercase fw600 |
| header card | pad `7px 11.2px`, margin `2px 0 8.4px`, gap 9px; name 13px, meta 10.5px | pad `6px 8px`, margin `2px 8px 6px`, gap 8px — type ✓ |

(The canvas's monogram chip measures 13×20 because it lacks `flex: none` — a prototype bug. Our
20×20 `shrink-0` is the correct intent; don't copy the squeeze.)

### Blocked — needs an engine surface (ask before building)

- **Tree header path** (`DEVELOPMENT` + `~/DEVELOPMENT`) — a read endpoint over
  `makeDefaultWorkspaceParentDirectory`.
- **Drilled-menu counts** — nine sections × a count each (sessions/agents/skills/rules/apps/…).
- **Account plan suffix** (`· Max`) — not on the users contract today.

### Blocked — contradicts a locked decision (ask, don't flatten)

- The canvas's drilled menu is a **flat list**; Chad's 2026-08-04 call made it **grouped**, and
  the whole customize store is built on groups. Do not flatten on canvas authority alone.
- Composer **actions/toggles** rows (Push Local · Send Git · Resort Back · Clarify before build ·
  Auto buildout · Rewrite with AI) stay deferred — no engine semantics, per the honest-data rule.

### Landed from that list (2026-08-15)

Calls made this session: **counts yes, tree-header path no** (skip the header row and its gutter
entirely; groups wear `PhFolders`, the new-folder / new-workspace icons move onto the Global row's
right edge) · **keep the grouped menu, adopt the canvas's type** · **chat goes full-bleed**.

- **Tree** (`WorkspaceTree.vue`, `WorkspaceTreeRow.vue`, `SidebarAccountRow.vue`): the column moved
  to `--color-bg` (was `bg-panel` — the canvas keeps the sidebar flush with the canvas, a hairline
  apart) and is padded `16.8px 8.4px`, so the parked group and the account foot sit inset like every
  other row. Rows are the canvas grid — `12px 16px minmax(0,1fr) auto`, pad `6px 11.2px 6px 10px`,
  10px caret, 7px meta cluster — so the name lands at rowX+54 exactly. Folder members carry the
  24px indent INSIDE the row (`indented` prop), so the active ground still spans the folder.
  `font-semibold` is gone from NOT RUNNING, the counts and the monogram.
- **Chat** (`ThreadStream.vue`, `WorkspaceView.vue`, `GlobalChatView.vue`): `.thread-column` lost
  its 920px cap and `.composer-dock` its 968px one — both are full-bleed at 22.4px gutters, with
  the canvas's `16px 22.4px 11.2px` / `10px 22.4px 12px`. Verified identical to the canvas at a
  matched 1120px column: header / column / dock all `1120@208`, card `1075@230`. Non-live cards
  lost their left border (`.turn-card:not(.is-live)`), and the header badge took the canvas's
  `.tag` geometry while keeping OUR status hue.
- **Section menu** (`AppSidebar.vue`): 35px rows at pad `8px 11.2px`, 2px list gap, the back row at
  11.5px non-uppercase, group headers as the canvas's 10px / 0.12em / weight-400 eyebrow, and the
  header card at pad `7px 11.2px` / margin `2px 0 8.4px`.
- **Section counts (engine)**: `countChatSessions` (new, `@vynel/chat` — the one unbounded set gets
  a real count query) + `GET /section-counts` and `GET /workspaces/:id/section-counts`
  (`routes/section-counts/`, no x-mcp — a menu decoration). Every other count calls the SAME core
  read its own list route calls, with the same arguments, so the number and the rows behind it
  cannot disagree; `count-sections.ts` records why. A section with no honest count renders NOTHING
  rather than a bare 0. Web: `use-section-counts.ts` (one request per scope) → `SidebarItem.count`.

**A trap worth remembering:** dropping `px-2` from the tree's `<ul>`s exposed the browser's default
40px `padding-inline-start` — `list-none` kills the marker, not the padding. Every list in both
sidebars now carries an explicit `pl-*`.

Still open from the diff list: the author line's time position (the canvas puts it inline after the
name behind a hairline divider; ours rides the right edge per Chad's 2026-08-09 "one vertical line
for every chevron" — kept deliberately, not overlooked), the three extra chat-header icons, user
avatars, and the account foot's `· Max` plan suffix.

### Reviewer gate (2026-08-15) — one must-fix, and the lesson

The `sessions` count was the ONE count that broke this arc's own rule ("call the
same core read the section's list route calls, take its length") — and it was the
only count that drifted. The Global menu read `Sessions 5` beside a list of 2: it
counted every scope's sessions while the Global library lists only the root's own
spawned children, and overview entries collapse continuity chains, so no
`chat_sessions` row count could have answered it at any scope.

The fix made the rule real rather than patching the number: `selectSessionsForScope`
now lives in `@vynel/contracts/chat/sessions-overview`, the library view and the
count both call it, and `countChatSessions` is deleted. **If a count needs a
predicate the section's own list doesn't already have, that predicate is in the
wrong place — hoist it, don't copy it.**

Also closed: counts refresh from the mutation cache (one rule, not a habit each
new feature must learn); `--thread-gutter` moved to the sidebar panel ROOT so it
reaches the composer and skeleton, which are the thread's siblings, not its
children; the caret drill-in target grew to 24px into the row's own padding (12px
was half the WCAG 2.5.8 floor — and growing it evenly would have painted over the
label button, since a positioned `::after` beats an unpositioned sibling); a pin
that fails if `ownedByWorkspaceOnly` is dropped; two stale geometry comments.

Left as deferred-improves, knowingly: `listAllRuleFilesForScope` reads every rule
file's full body to produce an integer (the cost of counting from the same source
that renders the rows — a `countRuleFilesForScope` would be faster but would start
counting unreadable files the list silently drops), and `getSessionsOverview`'s
50-entry cap bounds the sessions count the same way it bounds the library.
