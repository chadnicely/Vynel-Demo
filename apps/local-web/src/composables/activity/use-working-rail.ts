import { computed } from "vue";
import type { SessionTurnActivity } from "@vynel/contracts/chat/session-activity";
import { useInFlightDelegations } from "../delegations/use-in-flight-delegations.js";
import { usePendingApprovals } from "../approvals/use-pending-approvals.js";
import { useContinuingConversation } from "../chat/use-continuing-conversation.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { matchTurnToIdentity } from "./match-turn-to-identity.js";

// The working rail's roster (redesign, the rail clarification): "agents,
// sessions, workspaces all show as small icons — only active ones; once they
// complete, one after another they're gone." One entity per WORKING identity,
// composed from the two liveness sources the app already holds — the feed's
// presence map and the work-kind in-flight poll — never a new channel.
// Ephemeral SDK agents are a recorded follow-up (they need a running-agent-
// calls read; their tool card shows everything meanwhile).
//
// A feed turn is placed by IDENTITY, through the one matcher every feed reader
// uses (session-hardening D1) — never by the presence or absence of a field.
// The wire stamps `primarySessionId` on EVERY global and voice turn, so
// "names a primary" stopped meaning "a spawned session": that reading railed
// the user's own global turn as a nameless chip and pointed a voice chip at
// the spoken transcript (audit R2-A). The BRAIN is the turn whose primary IS
// the global primary — the id the continuing read hands back and the feed
// stamps — whatever drove it: the user's own turn, a Telegram reply, a
// schedule fire, a delivery. The spoken thread is its own chip, opening the
// Voice chat surface. A spawned or agent session names its own primary.

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
      /** The continuing identity — the component resolves a blank label (and
       *  a not-yet-served segment) from the sessions overview by it. */
      primarySessionId: string;
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
      hasAttention: false;
      isWorking: true;
      traceId: null;
    }
  | {
      kind: "voice";
      key: "voice";
      label: string;
      isColleague: false;
      hasAttention: false;
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

/** Which chip a live feed turn belongs to. */
export type RailChip =
  | { kind: "brain" }
  | { kind: "voice" }
  | { kind: "session"; primarySessionId: string }
  | { kind: "workspace"; workspaceId: string };

/** The rail's ONE identity decision. `globalPrimarySessionId` is the
 *  continuing read's `rootSessionId`; until it is known a global-family turn
 *  naming a primary is not placed at all (the `useContinuingSessionId`
 *  precedent: a beat of nothing beats a guess), because the frame alone
 *  cannot tell the brain from a session spawned under it. */
export function resolveRailChip(
  turn: SessionTurnActivity,
  globalPrimarySessionId: string | null,
): RailChip | null {
  if (matchTurnToIdentity(turn, { kind: "voice" })) return { kind: "voice" };
  const primarySessionId = turn.primarySessionId ?? null;
  if (primarySessionId !== null) {
    // Only a GLOBAL-family primary can be the brain's; a colleague announcing
    // under its grounding room names its own conversation.
    if (!matchTurnToIdentity(turn, { kind: "global" })) {
      return { kind: "session", primarySessionId };
    }
    if (globalPrimarySessionId === null) return null;
    return matchTurnToIdentity(turn, {
      kind: "primary",
      primarySessionId: globalPrimarySessionId,
    })
      ? { kind: "brain" }
      : { kind: "session", primarySessionId };
  }
  const workspaceId = turn.workspaceId;
  if (
    workspaceId !== null &&
    matchTurnToIdentity(turn, { kind: "workspace", workspaceId })
  ) {
    return { kind: "workspace", workspaceId };
  }
  // A global-area turn naming no primary (a direct delivery's begin/end
  // frame) is the brain's own background work.
  return matchTurnToIdentity(turn, { kind: "global" }) ? { kind: "brain" } : null;
}

export type RailContext = {
  approvalWorkspaceIds: ReadonlySet<string>;
  /** The global primary's id (`rootSessionId`) — null while it loads. */
  globalPrimarySessionId: string | null;
};

export function buildRailEntities(
  delegations: readonly InFlightRailSource[],
  serverTurns: readonly SessionTurnActivity[],
  context: RailContext,
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
        primarySessionId: delegation.targetPrimarySessionId,
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
        hasAttention: context.approvalWorkspaceIds.has(delegation.workspaceId),
        isWorking: delegation.status === "claimed",
        traceId: delegation.partialSessionId,
      });
    }
  }

  for (const turn of serverTurns) {
    const chip = resolveRailChip(turn, context.globalPrimarySessionId);
    if (chip === null) continue;
    switch (chip.kind) {
      case "brain":
        upsert({
          kind: "brain",
          key: "brain",
          label: "Claude",
          isColleague: false,
          hasAttention: false,
          isWorking: true,
          traceId: null,
        });
        break;
      case "voice":
        upsert({
          kind: "voice",
          key: "voice",
          label: "Voice chat",
          isColleague: false,
          hasAttention: false,
          isWorking: true,
          traceId: null,
        });
        break;
      case "session":
        upsert({
          kind: "session",
          key: `session:${chip.primarySessionId}`,
          primarySessionId: chip.primarySessionId,
          label: turn.personaName ?? "",
          segmentId: turn.sessionId,
          isColleague: false,
          hasAttention: false,
          isWorking: true,
          traceId: turn.partialSessionId ?? null,
        });
        break;
      case "workspace":
        upsert({
          kind: "workspace",
          key: `ws:${chip.workspaceId}`,
          workspaceId: chip.workspaceId,
          label: "",
          isColleague: false,
          hasAttention: context.approvalWorkspaceIds.has(chip.workspaceId),
          isWorking: true,
          traceId: turn.partialSessionId ?? null,
        });
        break;
    }
  }

  return ordered;
}

export function useWorkingRail() {
  const activity = useActivityStore();
  const inFlightQuery = useInFlightDelegations();
  const approvalsQuery = usePendingApprovals();
  // The brain's identity on the wire: the continuing read's `rootSessionId`
  // is the value the feed stamps as `primarySessionId` on every global turn.
  const globalContinuing = useContinuingConversation(() => ({ kind: "global" }));

  const entities = computed<RailEntity[]>(() => {
    const approvalWorkspaceIds = new Set<string>();
    for (const approval of approvalsQuery.data.value ?? []) {
      const workspaceId =
        (approval as { workspaceId?: string | null }).workspaceId ?? null;
      if (workspaceId !== null) approvalWorkspaceIds.add(workspaceId);
    }
    return buildRailEntities(
      inFlightQuery.data.value ?? [],
      Object.values(activity.serverTurns),
      {
        approvalWorkspaceIds,
        globalPrimarySessionId: globalContinuing.data.value?.rootSessionId ?? null,
      },
    );
  });

  return { entities };
}
