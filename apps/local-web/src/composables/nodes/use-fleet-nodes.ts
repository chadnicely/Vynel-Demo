import { computed, onBeforeUnmount, ref, toValue, type MaybeRefOrGetter } from "vue";
import { useTasks } from "../tasks/use-tasks.js";
import {
  isCompletedAndClear,
  isQueueWorking,
  taskQueueByWorkspace,
} from "../tasks/task-queue-summary.js";
import { useWorkspaceProgress } from "../workspaces/use-workspace-progress.js";
import { useActivityStore } from "../../stores/activity-store.js";
import {
  buildSceneNodes,
  type WorkspaceLike,
} from "../../utils/constellation-layout.js";
import type { SceneNode } from "../../utils/constellation-scene.js";

/** A project is live for an hour after its last sign of work. */
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

// The fleet's dots and the ONE reading of what colour each one is. It lives
// here rather than in the view because the sidebar's status dot answers the
// same question, and two surfaces disagreeing about whether a project is
// working is the bug this prevents.
export function useFleetNodes(
  workspaces: MaybeRefOrGetter<readonly WorkspaceLike[]>,
) {
  const activity = useActivityStore();
  const rows = computed(() => toValue(workspaces));

  const workspaceProgress = useWorkspaceProgress(() =>
    rows.value.map((room) => room.id),
  );
  // A project only goes green when its queue is drained (Chad, 2026-08-12).
  const tasksQuery = useTasks(true);
  const queueByWorkspace = computed(() =>
    taskQueueByWorkspace(tasksQuery.data.value),
  );

  // The minute tick is what lets a node actually drop out when its hour runs
  // dry; a computed alone never re-fires on the clock.
  const activeNowTick = ref(Date.now());
  const activeTickTimer = setInterval(() => {
    activeNowTick.value = Date.now();
  }, 60_000);
  onBeforeUnmount(() => clearInterval(activeTickTimer));

  // A live turn spins as "building"; otherwise a recently-worked project is
  // "done" when every step is finished, else "waiting" (it wants your next
  // word); a project quiet for over an hour is "idle" grey.
  function statusOf(id: string): SceneNode["status"] {
    const queue = queueByWorkspace.value.get(id);
    const liveTurn = activity.hasServerTurnInWorkspace(id);
    const progress = workspaceProgress.value[id];
    // Normalized to null so "never worked" is one value, not two.
    const lastWorkedAt = progress?.lastWorkedAt ?? null;
    const workedRecently =
      lastWorkedAt !== null &&
      activeNowTick.value - Date.parse(lastWorkedAt) < ACTIVE_WINDOW_MS;
    // A node only shows a LIVE status while the project is active — the SAME
    // window the sidebar uses to split Active from Not running (Chad,
    // 2026-08-12). This is what stops a dormant project with a stale
    // in-progress task from glowing "working" out here while it sits under
    // NOT RUNNING.
    const active = liveTurn || workedRecently;
    if (!active) return "idle";
    // Working (purple) = a live turn OR its queue running a task right now.
    if (liveTurn || isQueueWorking(queue)) return "building";
    // Finished and nothing left in the queue → the calmer "done" green.
    if (isCompletedAndClear(queue, progress)) return "done";
    // Otherwise it wants you — mid-build pause, or tasks queued not running.
    return "waiting";
  }

  return computed(() => buildSceneNodes(rows.value, statusOf));
}
