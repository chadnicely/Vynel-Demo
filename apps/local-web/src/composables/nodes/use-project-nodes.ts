import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { useSessionStatuses } from "../sessions/use-session-statuses.js";
import { useWorkspaceStatuses } from "../workspaces/use-workspace-status.js";
import { sessionKeys, sessionScopeKey } from "../chat/session-keys.js";
import { useVynel } from "../use-vynel.js";
import { initialsOf } from "../../utils/constellation-layout.js";
import type { SceneNode } from "../../utils/constellation-scene.js";
import {
  sceneNodeId,
  type SceneNodeRef,
} from "../../utils/constellation-node-ref.js";
import { resolveNodeStatus } from "./node-status.js";
import { projectMessages, type MessageEdgeLike } from "./message-scene-mapping.js";
import type { NodeLevel } from "./node-level.js";

// The SECOND level of the node screen (Chad, 2026-08-11): step inside one
// project and the dots become its own conversations. The room's continuing
// build is not one of them any more (Kafi, 2026-08-24): the CENTRE is the
// workspace manager — the primary session — so the centre wears the room's
// status and its click opens the room's chat, and only the CHILDREN orbit it.
// One truth, tree and node screen alike: the room's status IS the continuing
// thread's status (Move 3).
export function useProjectNodes(input: {
  workspaceId: MaybeRefOrGetter<string | null>;
  workspaceName: MaybeRefOrGetter<string | null>;
  edges: MaybeRefOrGetter<readonly MessageEdgeLike[]>;
  onPick: (ref: SceneNodeRef, label: string) => void;
  /** Opening the room's chat — the centre's click (the build's old door). */
  onCorePick: () => void;
}): NodeLevel {
  const vynel = useVynel();
  const workspaceStatuses = useWorkspaceStatuses();
  const id = computed(() => toValue(input.workspaceId));

  // SCOPED server-side, not filtered here. This used to read the app-wide,
  // 50-capped, unscoped overview and drop the other rooms' rows locally —
  // so once the user had 50 newer conversations anywhere, a drilled project
  // showed a SUBSET of its own sessions with no indication (2026-08-19
  // audit, A5-07 / B8). `use-sessions-library.ts` records the same lesson:
  // curate before the cap or the page arrives empty.
  const sessionsQuery = useQuery({
    queryKey: computed(() => [
      ...sessionKeys.all,
      "overview",
      sessionScopeKey({
        kind: "workspace" as const,
        workspaceId: id.value ?? "none",
      }),
    ]),
    queryFn: () =>
      vynel.sessions.overview({
        scope: "workspace" as const,
        workspaceId: id.value!,
      }) as Promise<SessionsOverviewEntry[]>,
    enabled: computed(() => id.value !== null),
  });

  const entries = computed<readonly SessionsOverviewEntry[]>(
    () => sessionsQuery.data.value ?? [],
  );

  // Statuses derive from OUR entries, not the shared read. The scoped list
  // above can hold rows the app-wide capped page never saw, and those rows
  // would otherwise have no status row at all and paint a confident grey.
  // Still ONE ladder: `useSessionStatuses` runs `deriveSessionStatus` over
  // whichever entries it is handed (the Sessions library's paging precedent).
  const sessionStatuses = useSessionStatuses(entries);

  const nodes = computed<SceneNode[]>(() => {
    const workspaceId = id.value;
    if (workspaceId === null) return [];
    return entries.value.map((entry) => {
      const view = sessionStatuses.statusFor(entry.sessionId);
      return {
        id: sceneNodeId({ kind: "session", id: entry.sessionId }),
        name: entry.title,
        initials: initialsOf(entry.title),
        status: resolveNodeStatus(view?.status ?? "idle"),
        ...(view === null ? {} : { detail: { note: view.note } }),
      };
    });
  });

  /** The sessions read has ANSWERED — a result or an error, like the fleet
   *  level: only then is "nothing here" the truth rather than the loading
   *  state, and a failed read must not leave the stage blank forever (no
   *  counts, no invitation, no error). */
  const hasAnswered = computed(
    () => sessionsQuery.data.value !== undefined || sessionsQuery.isError.value,
  );

  /** Every segment of every drawn conversation, pointing at the dot that
   *  draws it — how an arc finds its endpoint across a context swap. The
   *  room's own chain is deliberately NOT here: the primary IS the centre
   *  now, and an unmapped endpoint anchors at the core, which is exactly
   *  where its arcs belong. */
  const nodeIdBySegmentId = computed(() => {
    const byId = new Map<string, string>();
    for (const entry of entries.value) {
      const nodeId = sceneNodeId({ kind: "session", id: entry.sessionId });
      for (const segment of entry.segments) byId.set(segment.sessionId, nodeId);
    }
    return byId;
  });

  const messages = computed(() => {
    if (id.value === null) return [];
    return projectMessages(toValue(input.edges), {
      nodeIdBySegmentId: nodeIdBySegmentId.value,
    });
  });

  const coreLabel = computed(() => toValue(input.workspaceName) ?? "Project");
  // The centre wears the ROOM's status — the same one the tree row shows (it
  // reaches `problem` from a failed turn, `needs_input` from an approval or
  // the assistant's own set state).
  //
  // KNOWN OVER-CLAIM (inherited from the workspace ladder): an AGENT
  // colleague's turn announces under its grounding workspace, so a failing
  // colleague can light the centre as well as its own dot. The build chain is
  // hidden from the overview, so it has no per-conversation facts of its own
  // to read instead; splitting them is the fix if the double-light ever bites.
  const coreStatus = computed<SceneNode["status"]>(() => {
    const workspaceId = id.value;
    if (workspaceId === null) return "idle";
    return resolveNodeStatus(
      workspaceStatuses.statusByWorkspaceId.value[workspaceId]?.status ??
        "not_running",
    );
  });

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
