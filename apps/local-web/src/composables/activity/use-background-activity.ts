// The Background roster's data spine (persona-sessions B7): everything
// running or queued RIGHT NOW, grouped by the identity doing the work —
// built from the sources the app already holds (the in-flight delegations
// poll + the activity feed's server turns + the narration ring), seeded from
// the durable `GET /activity/running` read so a fresh window shows the truth
// before the stream's replay arrives. No new channel, no per-row SSE.

import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type {
  SessionTurnActivity,
  SessionTurnOrigin,
} from "@vynel/contracts/chat/session-activity";
import { useVynel } from "../use-vynel.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useTurnNarrationStore } from "../../stores/turn-narration-store.js";
import { useWorkspaceList } from "../workspaces/use-workspace-list.js";
import { useInFlightDelegations } from "../delegations/use-in-flight-delegations.js";
import {
  delegationPersonaName,
  delegationRowKey,
  delegationTaskState,
  findTurnForDelegation,
} from "../delegations/delegation-turn-pairing.js";
import { narrationLabelFor } from "../../components/home/narration-label.js";
import {
  usePersonaResolver,
  type ResolvedPersona,
} from "../personas/resolve-persona.js";

/** The in-flight delegation slice the builder reads (structural over the
 *  `root.listDelegations` DTO). */
export interface BackgroundDelegationInput {
  partialSessionId: string | null;
  workspaceId: string | null;
  workspaceName: string;
  targetPrimarySessionId: string | null;
  sessionName: string | null;
  taskLabel: string;
  status: "pending" | "claimed";
}

export interface BackgroundActivityRow {
  key: string;
  taskLabel: string | null;
  state: "queued" | "working";
  origin: SessionTurnOrigin | null;
  startedAt: string | null;
  turnId: string | null;
  /** The Watch/Stop handle — null for keyless jobs and non-delegation turns. */
  partialSessionId: string | null;
}

export interface BackgroundActivityGroup {
  key: string;
  personaName: string;
  workspaceId: string | null;
  workspaceName: string | null;
  /** The live sdk segment — the group's open-conversation drill target. */
  sessionId: string | null;
  /** Working rows first, queued after — the view renders the head big. */
  rows: BackgroundActivityRow[];
}

interface WorkspaceIdentity {
  name: string;
  managerName: string | null;
}

/** Pure: merge the three sources into persona groups. Server turns win over
 *  the durable seed (same turn, richer enrichment); a delegation row pairs
 *  with its turn by the per-hop trace key; turns no delegation claims
 *  (interactive, channel, schedule) stand as their own groups. */
export function buildBackgroundActivity(input: {
  delegations: BackgroundDelegationInput[];
  serverTurns: SessionTurnActivity[];
  seedTurns: SessionTurnActivity[];
  workspaceById: (id: string) => WorkspaceIdentity | null;
}): BackgroundActivityGroup[] {
  const turns = [...input.serverTurns];
  for (const seed of input.seedTurns) {
    if (!turns.some((turn) => turn.turnId === seed.turnId)) turns.push(seed);
  }

  interface PendingRow {
    row: BackgroundActivityRow;
    groupKey: string;
    personaName: string;
    workspaceId: string | null;
    workspaceName: string | null;
    sessionId: string | null;
  }
  const pendingRows: PendingRow[] = [];

  input.delegations.forEach((delegation, index) => {
    const turn = findTurnForDelegation(turns, delegation);
    const fallbackKey = delegationRowKey(delegation, index);
    const workspace =
      delegation.workspaceId === null
        ? null
        : input.workspaceById(delegation.workspaceId);
    pendingRows.push({
      row: {
        key: fallbackKey,
        taskLabel: delegation.taskLabel || null,
        state: delegationTaskState(delegation.status),
        origin: turn?.origin ?? null,
        startedAt: turn?.startedAt ?? null,
        turnId: turn?.turnId ?? null,
        partialSessionId: delegation.partialSessionId,
      },
      // Tasks on the same colleague/spawned session share its identity; a
      // workspace-target task belongs to the workspace persona.
      groupKey:
        delegation.targetPrimarySessionId ??
        (delegation.workspaceId === null
          ? fallbackKey
          : `ws:${delegation.workspaceId}`),
      // The roster's tail prefers the workspace MANAGER (it has the list at
      // hand) — the head would otherwise read "Acme" over "Acme".
      personaName:
        delegationPersonaName(delegation, turn) ??
        workspace?.managerName ??
        delegation.workspaceName,
      workspaceId: delegation.workspaceId,
      workspaceName:
        delegation.workspaceId === null ? null : delegation.workspaceName,
      sessionId: turn?.sessionId ?? null,
    });
  });

  const claimedTurnIds = new Set(
    pendingRows.map((pending) => pending.row.turnId).filter(Boolean),
  );
  for (const turn of turns) {
    if (claimedTurnIds.has(turn.turnId)) continue;
    const workspace =
      turn.workspaceId === null
        ? null
        : input.workspaceById(turn.workspaceId);
    pendingRows.push({
      row: {
        key: turn.turnId,
        taskLabel: turn.taskLabel ?? null,
        state: "working",
        origin: turn.origin,
        startedAt: turn.startedAt,
        turnId: turn.turnId,
        partialSessionId: turn.partialSessionId ?? null,
      },
      groupKey: turn.primarySessionId ?? turn.sessionId ?? turn.turnId,
      personaName:
        turn.personaName ??
        workspace?.managerName ??
        workspace?.name ??
        "Assistant",
      workspaceId: turn.workspaceId,
      workspaceName: workspace?.name ?? null,
      sessionId: turn.sessionId,
    });
  }

  const groups = new Map<string, BackgroundActivityGroup>();
  for (const pending of pendingRows) {
    let group = groups.get(pending.groupKey);
    if (group === undefined) {
      group = {
        key: pending.groupKey,
        personaName: pending.personaName,
        workspaceId: pending.workspaceId,
        workspaceName: pending.workspaceName,
        sessionId: pending.sessionId,
        rows: [],
      };
      groups.set(pending.groupKey, group);
    }
    if (group.sessionId === null && pending.sessionId !== null) {
      group.sessionId = pending.sessionId;
    }
    group.rows.push(pending.row);
  }

  const isWorking = (group: BackgroundActivityGroup) =>
    group.rows.some((row) => row.state === "working");
  for (const group of groups.values()) {
    group.rows.sort((a, b) =>
      a.state === b.state ? 0 : a.state === "working" ? -1 : 1,
    );
  }
  return [...groups.values()].sort((a, b) => {
    const aWorking = isWorking(a) ? 0 : 1;
    const bWorking = isWorking(b) ? 0 : 1;
    if (aWorking !== bWorking) return aWorking - bWorking;
    const aStarted = a.rows[0]?.startedAt ?? "";
    const bStarted = b.rows[0]?.startedAt ?? "";
    // Ties return 0 (a consistent comparator) — insertion order holds, so
    // queued-only groups keep the poll's row order between refetches.
    return aStarted < bStarted ? -1 : aStarted > bStarted ? 1 : 0;
  });
}

export interface BackgroundGroupView extends BackgroundActivityGroup {
  persona: ResolvedPersona;
  /** The working row's current step, in plain words. */
  narration: string | null;
}

/** Wires the builder to the app's live sources. `enabled` gates the durable
 *  seed read (fetch while the roster is open, quiet otherwise). */
export function useBackgroundActivity(enabled: () => boolean) {
  const vynel = useVynel();
  const activity = useActivityStore();
  const narration = useTurnNarrationStore();
  const workspacesQuery = useWorkspaceList();
  const { resolvePersona } = usePersonaResolver();

  // The delegations poll is the app-wide one (its query home) — but THIS
  // observer lives in the always-mounted panel, so it gates on the roster
  // like the seed does (the chat views keep their own ungated observers).
  const delegationsQuery = useInFlightDelegations(enabled);
  const runningSeedQuery = useQuery({
    queryKey: ["activity", "running"],
    queryFn: () => vynel.activity.listRunningTurns(),
    select: (response) => response.turns,
    enabled,
    refetchInterval: () => (enabled() ? 5000 : false),
  });

  const groups = computed<BackgroundGroupView[]>(() => {
    const workspaces = workspacesQuery.data.value ?? [];
    const built = buildBackgroundActivity({
      delegations: delegationsQuery.data.value ?? [],
      serverTurns: Object.values(activity.serverTurns),
      seedTurns: runningSeedQuery.data.value ?? [],
      workspaceById: (id) => {
        const workspace = workspaces.find((row) => row.id === id);
        return workspace === undefined
          ? null
          : { name: workspace.name, managerName: workspace.managerName };
      },
    });
    return built.map((group) => {
      const workingTurnId = group.rows.find(
        (row) => row.state === "working" && row.turnId !== null,
      )?.turnId;
      return {
        ...group,
        persona: resolvePersona({
          name: group.personaName,
          workspaceId: group.workspaceId,
        }),
        narration:
          workingTurnId == null
            ? null
            : narrationLabelFor(
                narration.narrationByTurnId[workingTurnId]?.current,
              ),
      };
    });
  });

  return { groups };
}
