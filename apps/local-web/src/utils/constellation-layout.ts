// What the constellation draws: turning the app's workspace rows + live
// activity into the scene's node list. Pure, so the mapping that decides
// "this one is working" is testable without a canvas.

import type { SceneNode } from "./constellation-scene.js";

export interface WorkspaceLike {
  id: string;
  name: string;
  isArchived: boolean;
}

/** Two initials for the node face — "Nicely Community" → "NC". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** The fleet's node list — the PROJECTS that are ready to work.
 *
 *  An archived room is deliberately not a dot (Chad, 2026-08-10): it cannot
 *  build, so showing it anyway makes the picture a lie.
 *
 *  `isReady` is the same guard for a second class of room that cannot build —
 *  one still waiting on setup. Nothing passes it yet: that reading needs a
 *  setup-completion stamp the workspace row does not carry here. It stays as
 *  the seam so the filter lands in one place when it does.
 *
 *  Each node's status comes from `statusOf` — this screen's own reading
 *  (building / waiting / done / idle), which is NOT yet main's shared one.
 *  See `composables/nodes/fleet-node-status.ts` for where the two differ. */
export function buildSceneNodes(
  workspaces: readonly WorkspaceLike[],
  statusOf: (workspaceId: string) => SceneNode["status"],
  options: { isReady?: (workspaceId: string) => boolean } = {},
): SceneNode[] {
  return workspaces
    .filter((workspace) => !workspace.isArchived)
    .filter((workspace) => options.isReady?.(workspace.id) ?? true)
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      initials: initialsOf(workspace.name),
      status: statusOf(workspace.id),
    }));
}
