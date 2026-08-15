import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useTasks } from "../tasks/use-tasks.js";
import { taskQueueByWorkspace } from "../tasks/task-queue-summary.js";
import { useWorkspaceProgress } from "../workspaces/use-workspace-progress.js";
import { useActivityStore } from "../../stores/activity-store.js";
import {
  buildSceneNodes,
  type WorkspaceLike,
} from "../../utils/constellation-layout.js";
import { resolveFleetNodeStatus } from "./node-status.js";
import { useActiveNowTick } from "./use-active-window.js";

// The fleet's dots. The colour rule itself lives in `node-status.ts` —
// pure, so the branch that decides "this one is working" is testable without
// a canvas or a query client.
export function useFleetNodes(
  workspaces: MaybeRefOrGetter<readonly WorkspaceLike[]>,
) {
  const activity = useActivityStore();
  const nowTick = useActiveNowTick();
  const rows = computed(() => toValue(workspaces));

  const workspaceProgress = useWorkspaceProgress(() =>
    rows.value.map((room) => room.id),
  );
  // A project only goes green when its queue is drained (Chad, 2026-08-12).
  const tasksQuery = useTasks(true);
  const queueByWorkspace = computed(() =>
    taskQueueByWorkspace(tasksQuery.data.value),
  );

  return computed(() =>
    buildSceneNodes(rows.value, (workspaceId) =>
      resolveFleetNodeStatus({
        liveTurn: activity.hasServerTurnInWorkspace(workspaceId),
        queue: queueByWorkspace.value.get(workspaceId),
        progress: workspaceProgress.value[workspaceId],
        nowMs: nowTick.value,
      }),
    ),
  );
}
