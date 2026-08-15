// One reading of "the queue" per project, shared by every surface that shows
// a project's status dot — the sidebar rows and the Mission Control nodes
// (Chad, 2026-08-12). A project only goes GREEN when its work finished AND
// nothing is left in the queue; a single task still open keeps it amber,
// because more is coming.

/** The queue reading for one project. */
export interface WorkspaceQueueSummary {
  /** Tasks not yet done — what is still waiting in the queue. */
  openCount: number;
  /** Tasks running right now (the queue's live card). A project with one of
   *  these is actively working, even when no chat turn is streaming. */
  inProgressCount: number;
  /** Every task the project holds, done or not. */
  total: number;
}

/** Structural shape — the web app casts SDK task rows, so we ask only for the
 *  two fields we read rather than coupling to a concrete task type. */
type TaskLike = { workspaceId: string | null; status: string };

/** Group a flat task list into a per-project queue reading. Global tasks (no
 *  workspace) are ignored — they never colour a project's dot. */
export function taskQueueByWorkspace(
  tasks: readonly TaskLike[] | undefined,
): Map<string, WorkspaceQueueSummary> {
  const map = new Map<string, WorkspaceQueueSummary>();
  for (const task of tasks ?? []) {
    const workspaceId = task.workspaceId ?? null;
    if (workspaceId === null) continue;
    const entry = map.get(workspaceId) ?? {
      openCount: 0,
      inProgressCount: 0,
      total: 0,
    };
    entry.total += 1;
    if (task.status !== "done") entry.openCount += 1;
    if (task.status === "in-progress") entry.inProgressCount += 1;
    map.set(workspaceId, entry);
  }
  return map;
}

/** Actively working: the queue has a task running right now. This is what
 *  turns a project GREEN even when no chat turn is streaming (Chad,
 *  2026-08-12) — a running queue IS work. */
export function isQueueWorking(
  queue: WorkspaceQueueSummary | undefined,
): boolean {
  return (queue?.inProgressCount ?? 0) > 0;
}

/** Green means finished AND clear: the working steps that ran are all done
 *  (or a queue that actually held tasks drained every one), and nothing is
 *  still open. Anything left in the queue returns false — keep it amber. */
export function isCompletedAndClear(
  queue: WorkspaceQueueSummary | undefined,
  steps: { done: number; total: number } | null | undefined,
): boolean {
  if ((queue?.openCount ?? 0) > 0) return false;
  const stepsComplete = (steps?.total ?? 0) > 0 && steps?.done === steps?.total;
  const queueDrained = (queue?.total ?? 0) > 0 && queue?.openCount === 0;
  return stepsComplete || queueDrained;
}
