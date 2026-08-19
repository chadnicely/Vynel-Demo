import { ref, type Ref } from "vue";
import {
  ROOT_LIST_KEY,
  withGroupPlaced,
  withWorkspacePlaced,
  writeTreeOrder,
  type TreeOrder,
} from "./tree-order.js";

// The tree's drag-and-drop, native HTML5 (the canvas's own pattern), for
// BOTH kinds of row: a workspace drags between rows (reorder), onto a group
// header (join it, last), or onto the root zone (leave it, last); a group
// drags above/below another group. Position lands in the local order (see
// tree-order.ts); membership changes go to the host through `onMoveWorkspace`
// and re-render from the server's answer. The composable owns the state and
// the drop math; the template only reports events and paints the indicators.

export type TreeDragSource = { kind: "workspace"; id: string } | { kind: "group"; id: string };

export type TreeDropEdge = "before" | "after";

export type TreeDropTarget =
  | { kind: "row"; workspaceId: string; listKey: string; edge: TreeDropEdge }
  | { kind: "group-header"; groupId: string }
  | { kind: "group-slot"; groupId: string; edge: TreeDropEdge }
  | { kind: "root" };

export function useTreeDragDrop(input: {
  order: Ref<TreeOrder>;
  /** Group ids as displayed, top to bottom. */
  displayedGroupIds: () => string[];
  /** Workspace ids of a list (group id or ROOT_LIST_KEY) as displayed. */
  displayedListIds: (listKey: string) => string[];
  /** The list a workspace currently sits in (server membership). */
  listKeyOfWorkspace: (workspaceId: string) => string;
  onMoveWorkspace: (workspaceId: string, groupId: string | null) => void;
}) {
  const dragging = ref<TreeDragSource | null>(null);
  const target = ref<TreeDropTarget | null>(null);

  function startWorkspaceDrag(workspaceId: string) {
    dragging.value = { kind: "workspace", id: workspaceId };
  }
  function startGroupDrag(groupId: string) {
    dragging.value = { kind: "group", id: groupId };
  }
  function endDrag() {
    dragging.value = null;
    target.value = null;
  }

  // Which half of the hovered element the pointer is in — the insertion line
  // paints on that side.
  function edgeOf(event: DragEvent): TreeDropEdge {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY - rect.top < rect.height / 2 ? "before" : "after";
  }

  function onRowDragOver(event: DragEvent, workspaceId: string, listKey: string) {
    if (dragging.value?.kind !== "workspace" || dragging.value.id === workspaceId) return;
    event.preventDefault();
    event.stopPropagation();
    target.value = { kind: "row", workspaceId, listKey, edge: edgeOf(event) };
  }

  function onGroupHeaderDragOver(event: DragEvent, groupId: string) {
    if (dragging.value === null) return;
    if (dragging.value.kind === "group" && dragging.value.id === groupId) return;
    event.preventDefault();
    event.stopPropagation();
    target.value =
      dragging.value.kind === "workspace"
        ? { kind: "group-header", groupId }
        : { kind: "group-slot", groupId, edge: edgeOf(event) };
  }

  function onRootDragOver(event: DragEvent) {
    if (dragging.value?.kind !== "workspace") return;
    event.preventDefault();
    target.value = { kind: "root" };
  }

  function clearTargetIf(predicate: (current: TreeDropTarget) => boolean) {
    if (target.value !== null && predicate(target.value)) target.value = null;
  }

  function drop() {
    const source = dragging.value;
    const landing = target.value;
    endDrag();
    if (source === null || landing === null) return;
    if (source.kind === "workspace") dropWorkspace(source.id, landing);
    else dropGroup(source.id, landing);
  }

  function dropWorkspace(workspaceId: string, landing: TreeDropTarget) {
    let listKey: string;
    let position: number;
    if (landing.kind === "row") {
      listKey = landing.listKey;
      const others = input.displayedListIds(listKey).filter((id) => id !== workspaceId);
      const index = others.indexOf(landing.workspaceId);
      position = landing.edge === "before" ? index : index + 1;
    } else if (landing.kind === "group-header") {
      listKey = landing.groupId;
      position = Number.MAX_SAFE_INTEGER;
    } else if (landing.kind === "root") {
      listKey = ROOT_LIST_KEY;
      position = Number.MAX_SAFE_INTEGER;
    } else {
      return;
    }
    if (input.listKeyOfWorkspace(workspaceId) !== listKey) {
      input.onMoveWorkspace(workspaceId, listKey === ROOT_LIST_KEY ? null : listKey);
    }
    input.order.value = withWorkspacePlaced(
      input.order.value,
      workspaceId,
      listKey,
      input.displayedListIds(listKey),
      position,
    );
    writeTreeOrder(input.order.value);
  }

  function dropGroup(groupId: string, landing: TreeDropTarget) {
    if (landing.kind !== "group-slot") return;
    const others = input.displayedGroupIds().filter((id) => id !== groupId);
    const index = others.indexOf(landing.groupId);
    const position = landing.edge === "before" ? index : index + 1;
    input.order.value = withGroupPlaced(
      input.order.value,
      groupId,
      input.displayedGroupIds(),
      position,
    );
    writeTreeOrder(input.order.value);
  }

  // ── Indicator reads for the template. ──
  function rowEdge(workspaceId: string): TreeDropEdge | null {
    const current = target.value;
    return current?.kind === "row" && current.workspaceId === workspaceId ? current.edge : null;
  }
  function groupSlotEdge(groupId: string): TreeDropEdge | null {
    const current = target.value;
    return current?.kind === "group-slot" && current.groupId === groupId ? current.edge : null;
  }
  function isGroupHeaderTarget(groupId: string): boolean {
    return target.value?.kind === "group-header" && target.value.groupId === groupId;
  }
  function isRootTarget(): boolean {
    return target.value?.kind === "root";
  }

  return {
    dragging,
    target,
    startWorkspaceDrag,
    startGroupDrag,
    endDrag,
    onRowDragOver,
    onGroupHeaderDragOver,
    onRootDragOver,
    clearTargetIf,
    drop,
    rowEdge,
    groupSlotEdge,
    isGroupHeaderTarget,
    isRootTarget,
  };
}
