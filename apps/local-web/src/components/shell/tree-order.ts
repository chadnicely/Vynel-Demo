// The tree's remembered ORDER — where the user dragged each group and each
// workspace (Kafi, 2026-08-19: rows keep their place no matter running or
// not). Membership (which group a workspace is in) lives on the workspace
// row; position is its own record — one JSON layout per user in the DB,
// held by the customize store and handed to the tree as a prop. Pure
// functions over that one shape: the tree sorts the server's lists by it and
// reports the new sequence on every drop. Ids the layout never met (a new
// workspace, another window's group) simply follow in the server's order;
// ids that vanished are ignored.

import type { TreeLayoutResponse } from "@vynel/contracts/customization/customization-http";

export const ROOT_LIST_KEY = "root";

export type TreeOrder = TreeLayoutResponse;

export function emptyTreeOrder(): TreeOrder {
  return { groups: [], workspaces: {} };
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

