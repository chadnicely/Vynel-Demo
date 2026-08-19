// The tree's remembered ORDER — where the user dragged each group and each
// workspace (Kafi, 2026-08-19: rows keep their place no matter running or
// not). Membership (which group a workspace is in) lives on the server;
// position is a navigation preference and lives locally beside the fold
// state, the same call Chad made for menu layout and colours. Pure
// functions over one persisted shape: the tree reads it, sorts the server's
// lists by it, and writes it back on every drop. Ids the store never met
// (a new workspace, another window's group) simply follow in the server's
// order; ids that vanished are ignored.

export const ROOT_LIST_KEY = "root";

export type TreeOrder = {
  /** Group ids, top to bottom. */
  groups: string[];
  /** Workspace ids per list — a group id, or ROOT_LIST_KEY for ungrouped. */
  workspaces: Record<string, string[]>;
};

const STORAGE_KEY = "vynel.tree.order";

export function emptyTreeOrder(): TreeOrder {
  return { groups: [], workspaces: {} };
}

// A corrupt stored value falls back to the server's order — losing a drag
// preference is the harmless failure, so no error surfaces.
export function readTreeOrder(): TreeOrder {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (parsed === null || typeof parsed !== "object") return emptyTreeOrder();
    const candidate = parsed as Partial<TreeOrder>;
    const groups = Array.isArray(candidate.groups) ? candidate.groups.filter(isString) : [];
    const workspaces: Record<string, string[]> = {};
    if (candidate.workspaces && typeof candidate.workspaces === "object") {
      for (const [key, ids] of Object.entries(candidate.workspaces)) {
        if (Array.isArray(ids)) workspaces[key] = ids.filter(isString);
      }
    }
    return { groups, workspaces };
  } catch {
    return emptyTreeOrder();
  }
}

export function writeTreeOrder(order: TreeOrder): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

/** Stored order first (only ids still present), then newcomers in the order given. */
export function sortByStoredOrder<T extends { id: string }>(
  items: T[],
  storedIds: string[] | undefined,
): T[] {
  if (!storedIds || storedIds.length === 0) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const placed: T[] = [];
  for (const id of storedIds) {
    const item = byId.get(id);
    if (item !== undefined) {
      placed.push(item);
      byId.delete(id);
    }
  }
  return [...placed, ...items.filter((item) => byId.has(item.id))];
}

/** Drop `groupId` at `position` in the DISPLAYED group order (`displayedIds`,
 *  as currently shown, dragged one included) — the whole displayed sequence
 *  becomes the stored one, so what the user sees is exactly what sticks. */
export function withGroupPlaced(
  order: TreeOrder,
  groupId: string,
  displayedIds: string[],
  position: number,
): TreeOrder {
  return { ...order, groups: placeInto(displayedIds, groupId, position) };
}

/** Drop `workspaceId` at `position` in the DISPLAYED sequence of `listKey`.
 *  Removes it from every other list — a workspace has exactly one place. */
export function withWorkspacePlaced(
  order: TreeOrder,
  workspaceId: string,
  listKey: string,
  displayedIds: string[],
  position: number,
): TreeOrder {
  const workspaces: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(order.workspaces)) {
    if (key !== listKey) workspaces[key] = ids.filter((id) => id !== workspaceId);
  }
  workspaces[listKey] = placeInto(displayedIds, workspaceId, position);
  return { ...order, workspaces };
}

// `position` counts places in the sequence WITHOUT the moved id (0 = first).
function placeInto(displayedIds: string[], movedId: string, position: number): string[] {
  const rest = displayedIds.filter((id) => id !== movedId);
  const at = Math.max(0, Math.min(position, rest.length));
  return [...rest.slice(0, at), movedId, ...rest.slice(at)];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
