import { computed, toValue, type MaybeRefOrGetter } from "vue";
import {
  useActivityMonitor,
  type ActivitySource,
} from "../activity/use-activity-monitor.js";

// The Watch panel's LIVE delegation trace — a thin adapter over the ONE
// activity source seam (sessions-surface Slice ①). All the lifecycle policy
// (status-gated attach, keep-alive poll under the stream, settle refetch +
// overlay swap, drop-path poll re-arm, identity guards) lives in
// `useActivityMonitor`; this keeps the established consumer contract.
export function useDelegationTraceLive(
  partialSessionId: MaybeRefOrGetter<string | null>,
) {
  const monitor = useActivityMonitor(
    computed<ActivitySource | null>(() => {
      const id = toValue(partialSessionId);
      return id === null ? null : { kind: "trace", id };
    }),
  );
  return {
    traceQuery: monitor.traceQuery,
    entries: monitor.entries,
    pendingApprovalToolName: monitor.pendingApprovalToolName,
    agentActivity: monitor.agentActivity,
    isStreaming: monitor.isStreaming,
  };
}
