import { computed } from "vue";
import type { ComputedRef } from "vue";
import { useActivityStore } from "../../stores/activity-store.js";
import { usePendingApprovals } from "../approvals/use-pending-approvals.js";
import { usePendingAsks } from "../asks/use-pending-asks.js";

/** One presence per scope, for every navigation surface (tab strip, workspace
 *  tree): the assistant is working there, it's waiting on the user there
 *  (a pending approval or ask), or it's quiet. */
export type WorkspacePresence = "working" | "attention" | "idle";

/** Derives per-workspace presence from the signals the app already carries:
 *  the activity store's in-flight server turns and the polled pending
 *  approvals/asks (both workspace-scoped, null = global). Attention wins over
 *  working — same precedence the title-bar presence dot uses: "needs you"
 *  matters more than "busy". */
export function useWorkspacePresence(): {
  presenceByWorkspaceId: ComputedRef<Record<string, WorkspacePresence>>;
  globalPresence: ComputedRef<WorkspacePresence>;
} {
  const activity = useActivityStore();
  const approvalsQuery = usePendingApprovals();
  const asksQuery = usePendingAsks();

  const attentionWorkspaceIds = computed(() => {
    const ids = new Set<string>();
    let global = false;
    for (const row of approvalsQuery.data.value ?? []) {
      if (row.workspaceId === null) global = true;
      else ids.add(row.workspaceId);
    }
    for (const row of asksQuery.data.value ?? []) {
      if (row.workspaceId === null) global = true;
      else ids.add(row.workspaceId);
    }
    return { ids, global };
  });

  const workingWorkspaceIds = computed(() => {
    const ids = new Set<string>();
    for (const turn of Object.values(activity.serverTurns)) {
      if (turn.scopeKind === "workspace" && turn.workspaceId !== null)
        ids.add(turn.workspaceId);
    }
    return ids;
  });

  const presenceByWorkspaceId = computed<Record<string, WorkspacePresence>>(() => {
    const presence: Record<string, WorkspacePresence> = {};
    for (const id of workingWorkspaceIds.value) presence[id] = "working";
    for (const id of attentionWorkspaceIds.value.ids) presence[id] = "attention";
    return presence;
  });

  const globalPresence = computed<WorkspacePresence>(() => {
    if (attentionWorkspaceIds.value.global) return "attention";
    if (activity.hasGlobalServerTurn) return "working";
    return "idle";
  });

  return { presenceByWorkspaceId, globalPresence };
}
