import { isAbsoluteFilePath } from "@vynel/ui";

// Where a file link lands: the files API is workspace-scoped (a path is read
// relative to a room's folder), so a clicked path must first find its room.
// Pure — the link router feeds it the workspace list and the active scope.

export interface FileLinkTarget {
  workspaceId: string;
  /** Forward-slashed, relative to the room's folder — the editor's key. */
  relativePath: string;
}

/** `:12` / `:12:4` after a file name is a position, not part of the path. */
function stripLineSuffix(path: string): string {
  return path.replace(/:\d+(?::\d+)?$/, "");
}

/** One comparable spelling: forward slashes, no trailing slash, lowercased
 *  (Windows and macOS folders are case-insensitive; the rare Linux collision
 *  is a mis-open, never a mis-write — the editor reads what it finds). */
function comparable(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function resolveFileLinkTarget(
  linkedPath: string,
  context: {
    workspaces: ReadonlyArray<{ id: string; path: string }>;
    /** The room the surface is on; null on the global surface. */
    activeWorkspaceId: string | null;
  },
): FileLinkTarget | null {
  const path = stripLineSuffix(linkedPath.trim());
  if (path === "") return null;

  if (!isAbsoluteFilePath(path)) {
    // A relative path is relative to the room the person is in — nothing to
    // resolve against on the global surface. A backslashed one is never
    // room-relative: it is the tail of an absolute Windows path (a spaced
    // folder broke the match), and opening it inside the room would be wrong.
    if (context.activeWorkspaceId === null || path.includes("\\")) return null;
    const relativePath = path.replace(/^\.\//, "");
    return { workspaceId: context.activeWorkspaceId, relativePath };
  }

  // The room whose folder CONTAINS the file — the deepest one when rooms nest.
  const target = comparable(path);
  let best: { workspaceId: string; rootLength: number } | null = null;
  for (const workspace of context.workspaces) {
    const root = comparable(workspace.path);
    if (root === "" || !target.startsWith(`${root}/`)) continue;
    if (best === null || root.length > best.rootLength) {
      best = { workspaceId: workspace.id, rootLength: root.length };
    }
  }
  if (best === null) return null;
  const relativePath = path.replace(/\\/g, "/").slice(best.rootLength + 1);
  return relativePath === "" ? null : { workspaceId: best.workspaceId, relativePath };
}
