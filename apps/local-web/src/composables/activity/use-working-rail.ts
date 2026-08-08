import { computed } from "vue";
import { useInFlightDelegations } from "../delegations/use-in-flight-delegations.js";
import { usePendingApprovals } from "../approvals/use-pending-approvals.js";
import { useActivityStore } from "../../stores/activity-store.js";

// The working rail's roster (redesign, the rail clarification): "agents,
// sessions, workspaces all show as small icons — only active ones; once they
// complete, one after another they're gone." One entity per WORKING identity,
// composed from the two liveness sources the app already holds — the feed's
// presence map and the work-kind in-flight poll — never a new channel.
// Ephemeral SDK agents are a recorded follow-up (they need a running-agent-
// calls read; their tool card shows everything meanwhile), and the BRAIN rails
// for its non-web background turns (a Telegram reply, a schedule fire —
// "everything is a session" includes it; your own web turn is the thread
// you're already looking at, so it never rails).

export type RailEntity =
  | {
      kind: "workspace";
      key: string;
      workspaceId: string;
      /** Empty when only the feed announced it — the component resolves the
       *  display name from the workspace list. */
      label: string;
      isColleague: false;
      hasAttention: boolean;
      isWorking: boolean;
      /** Click fallback when nothing else resolves. */
      traceId: string | null;
    }
  | {
      kind: "session";
      key: string;
      label: string;
      /** The conversation the click opens (the served current segment). */
      segmentId: string | null;
      isColleague: boolean;
      hasAttention: boolean;
      isWorking: boolean;
      traceId: string | null;
    }
  | {
      kind: "brain";
      key: "brain";
      label: string;
      isColleague: false;
      hasAttention: boolean;
      isWorking: true;
      traceId: null;
    };

type InFlightRailSource = {
  partialSessionId: string | null;
  workspaceId: string | null;
  workspaceName: string;
  targetPrimarySessionId: string | null;
  sessionName?: string | null;
  targetSessionId?: string | null;
  status: string;
  jobKind?: string;
};

/** The slice of a feed turn the builder reads — structural, testable. */
type RailTurnSource = {
  scopeKind: string;
  origin: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  primarySessionId?: string | null;
  partialSessionId?: string | null;
  personaName?: string | null;
};

export function buildRailEntities(
  delegations: readonly InFlightRailSource[],
  serverTurns: readonly RailTurnSource[],
  approvalWorkspaceIds: ReadonlySet<string>,
): RailEntity[] {
  const ordered: RailEntity[] = [];
  const byKey = new Map<string, RailEntity>();
  const upsert = (entity: RailEntity) => {
    const existing = byKey.get(entity.key);
    if (existing === undefined) {
      byKey.set(entity.key, entity);
      ordered.push(entity);
      return;
    }
    // Working beats queued; a resolved label/segment fills a blank one.
    if (entity.isWorking) existing.isWorking = true;
    if (existing.label === "" && entity.label !== "") existing.label = entity.label;
    if (
      existing.kind === "session" &&
      entity.kind === "session" &&
      existing.segmentId === null &&
      entity.segmentId !== null
    ) {
      existing.segmentId = entity.segmentId;
    }
  };

  for (const delegation of delegations) {
    if (delegation.targetPrimarySessionId !== null) {
      upsert({
        kind: "session",
        key: `session:${delegation.targetPrimarySessionId}`,
        label: delegation.sessionName ?? delegation.workspaceName,
        segmentId: delegation.targetSessionId ?? null,
        isColleague: delegation.jobKind === "agent-run",
        hasAttention: false,
        isWorking: delegation.status === "claimed",
        traceId: delegation.partialSessionId,
      });
    } else if (delegation.workspaceId !== null) {
      upsert({
        kind: "workspace",
        key: `ws:${delegation.workspaceId}`,
        workspaceId: delegation.workspaceId,
        label: delegation.workspaceName,
        isColleague: false,
        hasAttention: approvalWorkspaceIds.has(delegation.workspaceId),
        isWorking: delegation.status === "claimed",
        traceId: delegation.partialSessionId,
      });
    }
  }

  for (const turn of serverTurns) {
    if (turn.primarySessionId != null) {
      upsert({
        kind: "session",
        key: `session:${turn.primarySessionId}`,
        label: turn.personaName ?? "",
        segmentId: turn.sessionId ?? null,
        isColleague: false,
        hasAttention: false,
        isWorking: true,
        traceId: turn.partialSessionId ?? null,
      });
    } else if (turn.scopeKind === "workspace" && turn.workspaceId != null) {
      upsert({
        kind: "workspace",
        key: `ws:${turn.workspaceId}`,
        workspaceId: turn.workspaceId,
        label: "",
        isColleague: false,
        hasAttention: approvalWorkspaceIds.has(turn.workspaceId),
        isWorking: true,
        traceId: turn.partialSessionId ?? null,
      });
    } else if (turn.origin !== "web") {
      upsert({
        kind: "brain",
        key: "brain",
        label: "Claude",
        isColleague: false,
        hasAttention: false,
        isWorking: true,
        traceId: null,
      });
    }
  }

  return ordered;
}

export function useWorkingRail() {
  const activity = useActivityStore();
  const inFlightQuery = useInFlightDelegations();
  const approvalsQuery = usePendingApprovals();

  const entities = computed<RailEntity[]>(() => {
    const approvalWorkspaceIds = new Set<string>();
    for (const approval of approvalsQuery.data.value ?? []) {
      const workspaceId = (approval as { workspaceId?: string | null }).workspaceId;
      if (workspaceId != null) approvalWorkspaceIds.add(workspaceId);
    }
    return buildRailEntities(
      inFlightQuery.data.value ?? [],
      Object.values(activity.serverTurns),
      approvalWorkspaceIds,
    );
  });

  return { entities };
}
