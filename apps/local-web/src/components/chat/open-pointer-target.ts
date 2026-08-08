import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";
import type { ThreadPointerModel } from "./thread-pointers.js";

// The pointer click's ONE home (redesign Case 1): open the TARGET's real
// conversation in the sidebar, anchored at the row carrying the trace key —
// session segment first, workspace fallback. A pointer whose target resolves
// NOWHERE (a session job whose primary is still unlinked — a seconds-wide
// creation window) is a quiet no-op; the rail re-resolves on the next poll.
export function useOpenPointerTarget() {
  const sidebar = useConversationSidebarStore();

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
    }
  };
}
