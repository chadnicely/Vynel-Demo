import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";
import { useActivityMonitorStore } from "../../stores/activity-monitor-store.js";
import type { ThreadPointerModel } from "./thread-pointers.js";

// The pointer click's ONE home (redesign Case 1): open the TARGET's real
// conversation in the sidebar, anchored at the row carrying the trace key —
// session segment first, workspace fallback, and the trace view for the
// keyless edge. Both chat hosts route through this.
export function useOpenPointerTarget() {
  const sidebar = useConversationSidebarStore();
  const activityMonitor = useActivityMonitorStore();

  return function openPointerTarget(pointer: ThreadPointerModel): void {
    if (pointer.targetSessionId !== null) {
      sidebar.openSession({
        sessionId: pointer.targetSessionId,
        title: pointer.targetLabel,
        anchorTraceId: pointer.partialSessionId,
      });
    } else if (pointer.workspaceId !== null) {
      sidebar.openWorkspace({
        workspaceId: pointer.workspaceId,
        anchorTraceId: pointer.partialSessionId,
      });
    } else {
      activityMonitor.openTrace(pointer.partialSessionId);
    }
  };
}
