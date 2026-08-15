import { useQueries } from "@tanstack/vue-query";
import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { sessionKeys, sessionScopeKey } from "../chat/session-keys.js";
import { todoKeys } from "../todos/todo-keys.js";
import { useVynel } from "../use-vynel.js";

export type WorkspaceProgress = {
  /** "4/13" — steps done over steps planned, from the session's own dock. */
  done: number;
  total: number;
  /** ISO of the newest step touch — the project's last sign of work. Every
   *  build writes the dock, so this is when it last actually did something. */
  lastWorkedAt: string | null;
};

// The sidebar's "4/13" per project — REAL working steps, read from each
// project's CONTINUING conversation: the same session its room opens on, and
// the same todos its chat dock shows. (Not the sessions overview: a project's
// continuing chat is hidden end to end, so the overview deliberately never
// lists it — reading progress there found nothing, ever.) A project whose
// chat never planned steps simply has no fraction; nothing here is ever
// invented to fill the space.
export function useWorkspaceProgress(
  workspaceIds: MaybeRefOrGetter<readonly string[]>,
) {
  const vynel = useVynel();
  const ids = computed(() => toValue(workspaceIds));

  // Read-only per project — `chat.getContinuing` nulls until that room's
  // first turn, so asking never brings a conversation into being.
  const continuingQueries = useQueries({
    queries: computed(() =>
      ids.value.map((workspaceId) => ({
        queryKey: [
          ...sessionKeys.all,
          "continuing",
          sessionScopeKey({ kind: "workspace" as const, workspaceId }),
        ],
        queryFn: () => vynel.chat.getContinuing(workspaceId),
      })),
    ),
  });

  const watched = computed(() =>
    ids.value
      .map((workspaceId, index) => ({
        workspaceId,
        sessionId:
          continuingQueries.value[index]?.data?.currentSdkSessionId ?? undefined,
      }))
      .filter((pair): pair is { workspaceId: string; sessionId: string } =>
        pair.sessionId !== undefined,
      ),
  );

  const todoQueries = useQueries({
    queries: computed(() =>
      watched.value.map((pair) => ({
        queryKey: todoKeys.forSession(pair.sessionId),
        queryFn: () => vynel.todos.list({ sessionId: pair.sessionId }),
        staleTime: 15_000,
      })),
    ),
  });

  return computed<Record<string, WorkspaceProgress>>(() => {
    const progress: Record<string, WorkspaceProgress> = {};
    const todosByWorkspace = new Map(
      watched.value.map((pair, index) => [
        pair.workspaceId,
        todoQueries.value[index]?.data,
      ]),
    );
    ids.value.forEach((workspaceId, index) => {
      const todos = todosByWorkspace.get(workspaceId) ?? [];
      // CHATTING is working too (Chad, 2026-08-11): the conversation's own
      // newest-message clock counts alongside the step dock, so a room that
      // talked without planning steps still reads as running.
      const spokeAt =
        continuingQueries.value[index]?.data?.lastMessageAt ?? null;
      const lastWorkedAt = todos.reduce<string | null>(
        (newest, todo) =>
          newest === null || todo.updatedAt > newest ? todo.updatedAt : newest,
        spokeAt,
      );
      if (todos.length === 0 && lastWorkedAt === null) return;
      progress[workspaceId] = {
        done: todos.filter((todo) => todo.status === "done").length,
        total: todos.length,
        lastWorkedAt,
      };
    });
    return progress;
  });
}
