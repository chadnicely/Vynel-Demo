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
