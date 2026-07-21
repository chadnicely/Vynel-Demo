import { computed, toValue, type MaybeRefOrGetter } from "vue";
import {
  useActivityMonitor,
  type ActivitySource,
} from "../activity/use-activity-monitor.js";

// Watch ANY session live — a thin adapter over the ONE activity source seam
// (sessions-surface Slice ①): settled transcript ("old activity") + the live
// session-channel overlay, merged. V1 semantics unchanged: one attach = one
// turn (`turn-stream-ended` detaches; reopening Watch attaches fresh) — but the
// panel now opens onto the session's history instead of an empty pane.
export function useSessionWatch(sessionId: MaybeRefOrGetter<string | null>) {
  const monitor = useActivityMonitor(
    computed<ActivitySource | null>(() => {
      const id = toValue(sessionId);
      return id === null ? null : { kind: "session", id };
    }),
  );
  return {
    entries: monitor.entries,
    agentActivity: monitor.agentActivity,
    pendingApprovalToolName: monitor.pendingApprovalToolName,
    isStreaming: monitor.isStreaming,
    hasEnded: monitor.hasEnded,
    errorText: monitor.errorText,
  };
}
