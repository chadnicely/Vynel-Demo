import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useWorkspaceStatuses } from "../workspaces/use-workspace-status.js";
import {
  buildSceneNodes,
  type WorkspaceLike,
} from "../../utils/constellation-layout.js";
import { resolveNodeStatus } from "./node-status.js";

// The fleet's dots — one per project, wearing the SAME status the sidebar
// tree, the tab strip and the chat header wear (`use-workspace-status`).
//
// This used to run its own ladder over the task queue and an activity window,
// which is how four idle projects wore "NEEDS YOU" with nothing pending
// anywhere. The rule is now one rule (Kafi, 2026-08-17): waiting means a
// pending approval, a pending question, or the assistant's own set state —
// never "spoke recently and nothing else fits".
export function useFleetNodes(
  workspaces: MaybeRefOrGetter<readonly WorkspaceLike[]>,
) {
  const workspaceStatuses = useWorkspaceStatuses();
  const rows = computed(() => toValue(workspaces));

  const nodes = computed(() =>
    buildSceneNodes(rows.value, (workspaceId) =>
      resolveNodeStatus(
        workspaceStatuses.statusByWorkspaceId.value[workspaceId]?.status ??
          "not_running",
      ),
    ),
  );

  /** The status poll has answered, so a dot's colour is a reading rather than
   *  a guess. Without this every project rendered its fallback while
   *  `/workspaces/statuses` was in flight — the second, independent half of
   *  the recorded nodes bug (a claim made from data we did not have). */
  const hasAnswered = computed(
    () => workspaceStatuses.hasAnsweredStatuses.value,
  );

  return { nodes, hasAnswered };
}
