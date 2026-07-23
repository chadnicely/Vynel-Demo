# 2026-07-24 — Scope tabs (browser-style workspace multitasking)

Chad: "like new tab — on each tab we can keep unique workspace/global with their menus and
features … first tab will be always global, so on the workspace we don't need global. User
clicks + and on the tab title they can switch or select workspace." Strip placement: its own
row below the title bar.

## What shipped

- **`ui-store` tabs model** — the single `activeWorkspaceId` + `globalChat`/`workspaceChat`
  singletons became `tabs: ShellTab[]`: the pinned Global tab (`id: "global"`, never closes)
  plus workspace tabs, each carrying its own `ChatShellState` (mainView + target) and a
  runtime-only `lastRoutePath`. Actions: `activateTab` / `addWorkspaceTab` / `closeTab`
  (right-neighbor focus) / `retargetTab` (resets to the room's continuous chat) /
  `openWorkspaceTab` (focus-or-open, used by Home cards, hero deck, session rows) /
  `pruneWorkspaceTabs`. Strip persists to `vynel.tabs` (ids + workspaceIds only, fail-closed
  parse); the legacy `vynel.active-workspace` key migrates into one workspace tab, once.
- **`AppTabStrip.vue`** — data-blind strip below the title bar: Global tab (house icon, no
  close/dropdown), workspace tabs with accent monogram + per-tab workspace dropdown + close,
  `+` menu (workspaces + New workspace). Proper `tablist`/`tab`/`aria-selected` roles.
- **`AppTitleBar`** — the workspace switcher is GONE; the bar keeps identity, menus, title,
  presence, window controls.
- **`AppShell`** — scope (sidebar menu, session-library scoping, canvas shell) derives from
  the ACTIVE TAB, not the route; `RouterView :key="activeTabId"` so each tab is its own view
  instance; tab switches restore `lastRoutePath`; Home and global-only sections hop to the
  Global tab; deep-linked `/workspace` with no room falls back to the global chat; deleted
  workspaces take their tabs with them once the list loads.

## Learnings

- **Keyed RouterView + snapshot binding beats "active" accessors.** Closing the active tab
  flips store state synchronously, a beat before the keyed remount unmounts the old view — a
  view reading `ui.activeTab`/`ui.activeWorkspaceId` re-renders against the WRONG tab in that
  gap. `WorkspaceView` now binds ITS tab object once at setup (safe because the shell keys it
  per tab); retargets still flow (same object, mutated in place).
- **Route pushes live in ONE place.** Every tab mutation that changes the active tab routes
  through AppShell handlers (`selectTab`/`closeTab`/`addTab`/prune watch) — no store→router
  coupling, no watch-vs-push races over the destination.
- **Test fakes must satisfy transitive renders**: the workspace welcome hero reads
  `WORKSPACE_KIND_BUNDLES[workspace.kind]` — a fake row without `kind` crashes the mount with
  an unhandled rejection that surfaces as an unrelated-looking vnode error two tests later.
