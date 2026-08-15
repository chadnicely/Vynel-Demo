import { computed } from "vue";
import type { ComputedRef } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type {
  WorkspaceEffectiveStatus,
  WorkspaceStatusReport,
} from "@vynel/contracts/workspaces/workspace-status";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { usePendingApprovals } from "../approvals/use-pending-approvals.js";
import { usePendingAsks } from "../asks/use-pending-asks.js";

// THE one home for the workspace status vocabulary (redesign Arc 5b — "one
// status, one colour"): every navigation surface (tree rows, tab strip, work
// rail, chat header) reads THIS derivation, never its own. Facts come from
// three places the app already watches plus one polled read:
//   - the live activity feed (in-flight turns — fresher than any poll),
//   - the polled pending approvals/asks (the detected needs-input),
//   - GET /workspaces/statuses (the assistant-set state, the latest turn's
//     outcome, and the task rollup).
//
// Precedence (highest wins): problem → needs_input → running → completed →
// not_running. An assistant-set state is a FACT with a timestamp — it stands
// until a turn STARTS after it (the user's next message supersedes it), which
// is exactly "completed shows until the next message".

/** One workspace's rendered status + the numbers beside it. */
export interface WorkspaceStatusView {
  status: WorkspaceEffectiveStatus;
  /** The assistant's one-line why — only when the SET state is what shows. */
  note: string | null;
  tasksDone: number;
  tasksTotal: number;
}

export function useWorkspaceStatusReports() {
  const vynel = useVynel();
  return useQuery({
    queryKey: workspaceKeys.statuses(),
    queryFn: async () =>
      (await vynel.workspaces.listStatuses()) as WorkspaceStatusReport[],
    // Poll like the approvals notifier; the activity feed's turn-ended
    // invalidation (workspaceKeys.all) lands changes faster when a turn
    // settles. Set-status writes land on the next tick.
    refetchInterval: 5_000,
    retry: false,
  });
}

export function useWorkspaceStatuses(): {
  statusByWorkspaceId: ComputedRef<Record<string, WorkspaceStatusView>>;
  globalStatus: ComputedRef<WorkspaceEffectiveStatus>;
} {
  const activity = useActivityStore();
  const approvalsQuery = usePendingApprovals();
  const asksQuery = usePendingAsks();
  const reportsQuery = useWorkspaceStatusReports();

  const attention = computed(() => {
    const ids = new Set<string>();
    let global = false;
    for (const row of approvalsQuery.data.value ?? []) {
      if (row.workspaceId === null) global = true;
      else ids.add(row.workspaceId);
    }
    for (const row of asksQuery.data.value ?? []) {
      if (row.workspaceId === null) global = true;
      else ids.add(row.workspaceId);
    }
    return { ids, global };
  });

  const runningTurnStartByWorkspaceId = computed(() => {
    const startedAt = new Map<string, number>();
    for (const turn of Object.values(activity.serverTurns)) {
      if (turn.scopeKind !== "workspace" || turn.workspaceId === null) continue;
      const ms = new Date(turn.startedAt).getTime();
      const known = startedAt.get(turn.workspaceId);
      if (known === undefined || ms > known) startedAt.set(turn.workspaceId, ms);
    }
    return startedAt;
  });

  const statusByWorkspaceId = computed<Record<string, WorkspaceStatusView>>(() => {
    const views: Record<string, WorkspaceStatusView> = {};
    const reports = reportsQuery.data.value ?? [];
    const liveStarts = runningTurnStartByWorkspaceId.value;

    const seen = new Set<string>();
    for (const report of reports) {
      seen.add(report.workspaceId);
      views[report.workspaceId] = deriveView(
        report,
        liveStarts.get(report.workspaceId) ?? null,
        attention.value.ids.has(report.workspaceId),
      );
    }
    // A workspace the report poll hasn't caught up with yet (just created,
    // stale cache) still shows its LIVE signals.
    for (const [workspaceId, startMs] of liveStarts) {
      if (!seen.has(workspaceId)) {
        views[workspaceId] = deriveView(null, startMs, attention.value.ids.has(workspaceId));
      }
    }
    for (const workspaceId of attention.value.ids) {
      if (views[workspaceId] === undefined) {
        views[workspaceId] = deriveView(null, null, true);
      }
    }
    return views;
  });

  const globalStatus = computed<WorkspaceEffectiveStatus>(() => {
    if (attention.value.global) return "needs_input";
    if (activity.hasGlobalServerTurn) return "running";
    return "not_running";
  });

  return { statusByWorkspaceId, globalStatus };
}

/** The precedence, in one place — exported for its colocated test. `liveTurnStartMs`
 *  is the feed's in-flight turn (null when quiet); `hasAttention` is a pending
 *  approval/ask. */
export function deriveView(
  report: WorkspaceStatusReport | null,
  liveTurnStartMs: number | null,
  hasAttention: boolean,
): WorkspaceStatusView {
  const tasksDone = report?.tasksDone ?? 0;
  const tasksTotal = report?.tasksTotal ?? 0;

  // The set state stands unless a turn STARTED after it was written.
  const setAtMs = report?.statusSetAt === null || report?.statusSetAt === undefined
    ? null
    : new Date(report.statusSetAt).getTime();
  const latestTurn = report?.latestTurn ?? null;
  const latestStartMs = Math.max(
    liveTurnStartMs ?? Number.NEGATIVE_INFINITY,
    latestTurn === null ? Number.NEGATIVE_INFINITY : new Date(latestTurn.startedAt).getTime(),
  );
  const setStanding =
    report?.setStatus != null && setAtMs !== null && setAtMs >= latestStartMs
      ? report.setStatus
      : null;

  // Running = the live feed says so, or the report's latest turn is still
  // open (covers the boot window before the feed reconnects; a stale open
  // row refreshes on the feed's turn-ended invalidation).
  const isRunning = liveTurnStartMs !== null || (latestTurn !== null && latestTurn.endedAt === null);
  // The "stuck on an error" detection: the LATEST turn failed (or the process
  // died mid-turn) and nothing newer runs. A live turn outdates the failure.
  const latestFailed =
    !isRunning &&
    latestTurn !== null &&
    (latestTurn.endedReason === "failed" || latestTurn.endedReason === "orphaned");

  const status: WorkspaceEffectiveStatus =
    setStanding === "problem" || latestFailed
      ? "problem"
      : hasAttention || setStanding === "needs_input"
        ? "needs_input"
        : isRunning
          ? "running"
          : setStanding === "completed"
            ? "completed"
            : "not_running";

  // The note travels ONLY when the set state is what actually shows — a
  // completed-note under a "working" kicker (set mid-turn) would misattribute.
  const note =
    setStanding !== null && status === setStanding ? (report?.statusNote ?? null) : null;

  return { status, note, tasksDone, tasksTotal };
}
