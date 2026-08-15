import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useSessionsOverview } from "../sessions/use-sessions-overview.js";
import { sessionKeys, sessionScopeKey } from "../chat/session-keys.js";
import { useVynel } from "../use-vynel.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { initialsOf } from "../../utils/constellation-layout.js";
import type { SceneNode } from "../../utils/constellation-scene.js";
import { resolveConversationNodeStatus } from "./node-status.js";
import { useActiveNowTick } from "./use-active-window.js";

// The SECOND level of the node screen (Chad, 2026-08-11): step inside one
// project and the dots become its own conversations — the continuing build
// first, then every session it holds.
export function useProjectNodes(projectId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const activity = useActivityStore();
  const nowTick = useActiveNowTick();
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

  function statusOfConversation(
    sessionId: string | null,
    lastMessageAt: string | null,
  ): SceneNode["status"] {
    return resolveConversationNodeStatus({
      hasLiveTurn:
        sessionId !== null && activity.serverTurnForSession(sessionId) !== null,
      lastMessageAt,
      nowMs: nowTick.value,
    });
  }

  const nodes = computed<SceneNode[]>(() => {
    const workspaceId = id.value;
    if (workspaceId === null) return [];
    const rows: SceneNode[] = [];
    const continuing = continuingQuery.data.value;
    if ((continuing?.rootSessionId ?? null) !== null) {
      rows.push({
        id: `continuing:${workspaceId}`,
        name: "The build",
        initials: "BD",
        status: statusOfConversation(
          continuing?.currentSdkSessionId ?? null,
          continuing?.lastMessageAt ?? null,
        ),
      });
    }
    for (const row of sessionsQuery.data.value ?? []) {
      if (row.workspaceId !== workspaceId) continue;
      rows.push({
        id: `session:${row.sessionId}`,
        name: row.title,
        initials: initialsOf(row.title),
        status: statusOfConversation(row.sessionId, row.lastMessageAt),
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

  return { nodes, hasAnswered };
}
