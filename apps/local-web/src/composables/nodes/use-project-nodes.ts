import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useSessionsOverview } from "../sessions/use-sessions-overview.js";
import { sessionKeys, sessionScopeKey } from "../chat/session-keys.js";
import { useVynel } from "../use-vynel.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { initialsOf } from "../../utils/constellation-layout.js";
import type { SceneNode } from "../../utils/constellation-scene.js";

// The SECOND level of the node screen (Chad, 2026-08-11): step inside one
// project and the dots become its own conversations — the continuing build
// first, then every session it holds.
export function useProjectNodes(projectId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const activity = useActivityStore();
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
  });

  const nodes = computed<SceneNode[]>(() => {
    const workspaceId = id.value;
    if (workspaceId === null) return [];
    const isTurning = activity.hasServerTurnInWorkspace(workspaceId);
    const rows: SceneNode[] = [];
    if ((continuingQuery.data.value?.rootSessionId ?? null) !== null) {
      rows.push({
        id: `continuing:${workspaceId}`,
        name: "The build",
        initials: "BD",
        // The continuing conversation is where a live turn actually runs.
        status: isTurning ? "building" : "idle",
      });
    }
    for (const row of sessionsQuery.data.value ?? []) {
      if (row.workspaceId !== workspaceId) continue;
      rows.push({
        id: `session:${row.sessionId}`,
        name: row.title,
        initials: initialsOf(row.title),
        status: "idle",
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
