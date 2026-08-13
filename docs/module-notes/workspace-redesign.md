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

## Known deferrals (deliberate, not forgotten)

- **Folders** (design: DEVELOPMENT header, drag-drop rows, dashed drop targets) → Arc 2b: a
  fresh `workspace_groups` slice in the workspaces leaf (same-leaf FK is fine; outbox events;
  migration; tests) + tree drag-drop. The boss's `project-groups-store` is reference only.
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
