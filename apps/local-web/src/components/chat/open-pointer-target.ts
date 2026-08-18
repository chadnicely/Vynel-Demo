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
    // An agent-run pointer's door is the nested activity pane — a subagent has
    // no conversation to land in. Null host = a live turn whose session row
    // hasn't streamed yet (seconds-wide); quiet no-op, same as below.
    if (pointer.agentRun != null) {
      if (pointer.agentRun.hostSessionId !== null) {
        sidebar.openAgentRun({
          sessionId: pointer.agentRun.hostSessionId,
          toolUseId: pointer.agentRun.toolUseId,
          title: pointer.taskLabel,
        });
      }
      return;
    }
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
