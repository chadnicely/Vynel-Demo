import { computed, toValue, type MaybeRefOrGetter } from "vue";
import {
  useWorkspaceStatuses,
  useWorkspaceStatusReports,
} from "../workspaces/use-workspace-status.js";
import { usePendingApprovals } from "../approvals/use-pending-approvals.js";
import { usePendingAsks } from "../asks/use-pending-asks.js";
import { useVoiceChatStatus } from "../sessions/use-voice-chat-status.js";
import {
  buildSceneNodes,
  type WorkspaceLike,
} from "../../utils/constellation-layout.js";
import type { SceneNode } from "../../utils/constellation-scene.js";
import {
  sceneNodeId,
  type SceneNodeRef,
} from "../../utils/constellation-node-ref.js";
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
//
// The CENTRE is the global primary session (Kafi, 2026-08-24): it wears the
// global area's status, its click opens the global chat, and the spoken
// thread rides beside it as a MOON on the first orbit — the child-of-global
// relation `constellation-node-ref.ts` recorded, finally drawn.
export function useFleetNodes(input: {
  workspaces: MaybeRefOrGetter<readonly WorkspaceLike[]>;
  /** The fleet read has come back — separate from the STATUS read below,
   *  because they are two different queries and either can still be flying. */
  workspacesAnswered: MaybeRefOrGetter<boolean>;
  edges: MaybeRefOrGetter<readonly MessageEdgeLike[]>;
  /** The room's customized image, from the customize store — the dot wears
   *  the same face the sidebar tree does. */
  imageOf: (workspaceId: string) => string | null;
  onPick: (ref: SceneNodeRef, label: string) => void;
  /** Opening the global primary — the centre's click. */
  onCorePick: () => void;
}): NodeLevel {
  const workspaceStatuses = useWorkspaceStatuses();
  const voice = useVoiceChatStatus();
  const rows = computed(() => toValue(input.workspaces));

  // The spoken thread — global's one satellite-of-the-centre. Drawn once the
  // thread EXISTS (a user who never spoke sees no moon); its status is the
  // same ladder every conversation reads. The ref's id space is the kind
  // itself: there is exactly one spoken thread per user, and its door is the
  // Voice chat surface, not a row.
  const voiceMoon = computed<SceneNode | null>(() =>
    voice.entry.value === null
      ? null
      : {
          id: sceneNodeId({ kind: "voice", id: "thread" }),
          name: "Voice",
          initials: "VO",
          role: "moon",
          status: resolveNodeStatus(voice.status.value?.status ?? "idle"),
        },
  );

  const nodes = computed(() => {
    const fleet = buildSceneNodes(
      rows.value,
      (workspaceId) =>
        resolveNodeStatus(
          workspaceStatuses.statusByWorkspaceId.value[workspaceId]?.status ??
            "not_running",
        ),
      {
        imageOf: input.imageOf,
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
    );
    return voiceMoon.value === null ? fleet : [...fleet, voiceMoon.value];
  });

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
  // The centre = the global primary: the global AREA's status (the brain's
  // own turn, or anything it is orchestrating), the same reading the shell's
  // global light shows.
  const coreStatus = computed(() =>
    resolveNodeStatus(workspaceStatuses.globalStatus.value),
  );

  return {
    nodes,
    messages,
    coreLabel,
    coreStatus,
    hasAnswered,
    onPick: input.onPick,
    onCorePick: input.onCorePick,
  };
}
