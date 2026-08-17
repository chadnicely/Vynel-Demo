import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useSessionsOverview } from "../sessions/use-sessions-overview.js";
import { useSessionStatuses } from "../sessions/use-session-statuses.js";
import { useWorkspaceStatuses } from "../workspaces/use-workspace-status.js";
import { sessionKeys, sessionScopeKey } from "../chat/session-keys.js";
import { useVynel } from "../use-vynel.js";
import { initialsOf } from "../../utils/constellation-layout.js";
import type { SceneNode } from "../../utils/constellation-scene.js";
import { resolveConversationNodeStatus } from "./node-status.js";

// The SECOND level of the node screen (Chad, 2026-08-11): step inside one
// project and the dots become its own conversations — the continuing build
// first, then every session it holds. Both readings come from main's real
// ladders (Move 3): each session's own derived status, and — for the build —
// the ROOM's status, since the continuing thread is what the room's status
// already describes (one truth, tree and node screen alike).
export function useProjectNodes(projectId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const sessionStatuses = useSessionStatuses();
  const workspaceStatuses = useWorkspaceStatuses();
  const id = computed(() => toValue(projectId));

  const sessionsQuery = useSessionsOverview(() => id.value !== null);
  // The project's continuing build is hidden from the overview end to end, so
  // it is asked for by name — read-only, nulls until the room's first turn.
  const continuingQuery = useQuery({
    queryKey: computed(() => [
      ...sessionKeys.all,
      "continuing",
      sessionScopeKey({
        kind: "workspace" as const,
        workspaceId: id.value ?? "none",
      }),
    ]),
    queryFn: () => vynel.chat.getContinuing(id.value!),
    enabled: computed(() => id.value !== null),
    staleTime: 15_000,
  });

  const nodes = computed<SceneNode[]>(() => {
    const workspaceId = id.value;
    if (workspaceId === null) return [];
    const rows: SceneNode[] = [];
    const continuing = continuingQuery.data.value;
    if ((continuing?.rootSessionId ?? null) !== null) {
      // The build IS the room's ongoing conversation, so it wears the room's
      // status — the same one the tree row shows (it reaches `problem` from a
      // failed turn, `needs_input` from an approval or the assistant's own
      // set state).
      //
      // KNOWN OVER-CLAIM (inherited from the workspace ladder, and the reason
      // this note is worth keeping): an AGENT colleague's turn announces under
      // its grounding workspace, so a failing colleague can light this dot as
      // well as its own. The build chain is hidden from the overview, so it
      // has no per-conversation facts of its own to read instead; splitting
      // them is the fix if the double-dot ever bites.
      rows.push({
        id: `continuing:${workspaceId}`,
        name: "The build",
        initials: "BD",
        status: resolveConversationNodeStatus(
          workspaceStatuses.statusByWorkspaceId.value[workspaceId]?.status ??
            "not_running",
        ),
      });
    }
    for (const row of sessionsQuery.data.value ?? []) {
      if (row.workspaceId !== workspaceId) continue;
      rows.push({
        id: `session:${row.sessionId}`,
        name: row.title,
        initials: initialsOf(row.title),
        status: resolveConversationNodeStatus(
          sessionStatuses.statusFor(row.sessionId)?.status ?? "idle",
        ),
      });
    }
    return rows;
  });

  /** Both reads have answered — only then is "nothing here" the truth rather
   *  than the loading state. */
  const hasAnswered = computed(
    () =>
      sessionsQuery.data.value !== undefined &&
      continuingQuery.data.value !== undefined,
  );

  /** The segment the continuing build is currently on — how "The build" node
   *  recognises itself as the sender or target of a message. */
  const continuingSessionId = computed(
    () => continuingQuery.data.value?.currentSdkSessionId ?? null,
  );

  return { nodes, hasAnswered, continuingSessionId };
}
