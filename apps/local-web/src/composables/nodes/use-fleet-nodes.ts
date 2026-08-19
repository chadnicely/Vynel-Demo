import { computed, toValue, type MaybeRefOrGetter } from "vue";
import {
  useWorkspaceStatuses,
  useWorkspaceStatusReports,
} from "../workspaces/use-workspace-status.js";
import { usePendingApprovals } from "../approvals/use-pending-approvals.js";
import { usePendingAsks } from "../asks/use-pending-asks.js";
import {
  buildSceneNodes,
  type WorkspaceLike,
} from "../../utils/constellation-layout.js";
import type { SceneNodeRef } from "../../utils/constellation-node-ref.js";
import { resolveNodeStatus } from "./node-status.js";
import { fleetMessages, type MessageEdgeLike } from "./message-scene-mapping.js";
import type { NodeLevel } from "./node-level.js";

// The FLEET level — one dot per project, wearing the SAME status the sidebar
// tree, the tab strip and the chat header wear (`use-workspace-status`).
//
// This used to run its own ladder over the task queue and an activity window,
// which is how four idle projects wore "NEEDS YOU" with nothing pending
// anywhere. The rule is now one rule (Kafi, 2026-08-17): waiting means a
// pending approval, a pending question, or the assistant's own set state —
// never "spoke recently and nothing else fits".
export function useFleetNodes(input: {
  workspaces: MaybeRefOrGetter<readonly WorkspaceLike[]>;
  /** The fleet read has come back — separate from the STATUS read below,
   *  because they are two different queries and either can still be flying. */
  workspacesAnswered: MaybeRefOrGetter<boolean>;
  edges: MaybeRefOrGetter<readonly MessageEdgeLike[]>;
  onPick: (ref: SceneNodeRef, label: string) => void;
}): NodeLevel {
  const workspaceStatuses = useWorkspaceStatuses();
  const rows = computed(() => toValue(input.workspaces));

  const nodes = computed(() =>
    buildSceneNodes(
      rows.value,
      (workspaceId) =>
        resolveNodeStatus(
          workspaceStatuses.statusByWorkspaceId.value[workspaceId]?.status ??
            "not_running",
        ),
      {
        // Everything the ladder already worked out and this screen used to
        // throw away. Carried, not drawn — D7 defers the visual.
        detailOf: (workspaceId) => {
          const view = workspaceStatuses.statusByWorkspaceId.value[workspaceId];
          return view === undefined
            ? undefined
            : {
                note: view.note,
                tasksDone: view.tasksDone,
                tasksTotal: view.tasksTotal,
              };
        },
      },
    ),
  );

  // The same three polls `hasAnsweredStatuses` is composed from (vue-query
  // dedupes by key, so reading them here costs no extra request). We need
  // their FAILURES too: a poll that errored has answered — badly, but
  // answered — and treating it as still-in-flight would withhold the fleet's
  // reading forever behind one broken endpoint, which is a worse lie than the
  // one this gate exists to stop.
  const statusReportsQuery = useWorkspaceStatusReports();
  const approvalsQuery = usePendingApprovals();
  const asksQuery = usePendingAsks();

  /** Both reads have answered, so a dot's colour is a reading rather than a
   *  guess. Without this every project rendered its fallback while
   *  `/workspaces/statuses` was in flight — the second, independent half of
   *  the recorded nodes bug (a claim made from data we did not have). The
   *  fleet bar reads it too: it used to announce "N idle" over exactly that
   *  window (2026-08-19 audit, agent-4 §5a). */
  const hasAnswered = computed(
    () =>
      toValue(input.workspacesAnswered) &&
      (workspaceStatuses.hasAnsweredStatuses.value ||
        statusReportsQuery.isError.value ||
        approvalsQuery.isError.value ||
        asksQuery.isError.value),
  );

  const drawnIds = computed(() => new Set(nodes.value.map((node) => node.id)));
  const messages = computed(() =>
    fleetMessages(toValue(input.edges), drawnIds.value),
  );

  const coreLabel = computed(() => "Vynel");

  return { nodes, messages, coreLabel, hasAnswered, onPick: input.onPick };
}
