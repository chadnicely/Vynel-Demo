import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useInfiniteQuery } from "@tanstack/vue-query";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { useVynel } from "../use-vynel.js";
import { sessionKeys } from "../chat/session-keys.js";

// The Sessions library's own read — one PAGE of conversations at a time.
//
// Separate from `useSessionsOverview` on purpose. That query is the app-wide
// one: the status of every row and dot, the composer's context ring, the node
// screen. It wants the recent conversations, capped, shared by seven surfaces.
// This one wants ALL of them in a scope, which past 50 the shared read simply
// could not answer — it returned the newest 50 and said nothing about the
// rest, leaving older conversations unreachable from the UI.
//
// The scope is applied SERVER-side so pages are dense. Filtering client-side
// would hand a page of 50 mixed-scope entries to a drilled room and yield
// three rows, and the scroll would stall while there was plenty left.

const PAGE_SIZE = 50;

export function useSessionsLibrary(
  workspaceScopeId: MaybeRefOrGetter<string | null>,
) {
  const vynel = useVynel();
  const scopeId = computed(() => toValue(workspaceScopeId));

  const query = useInfiniteQuery({
    queryKey: computed(() =>
      sessionKeys.library(scopeId.value === null ? "global" : `ws:${scopeId.value}`),
    ),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      vynel.sessions.overview({
        limit: PAGE_SIZE,
        offset: pageParam as number,
        ...(scopeId.value === null
          ? { scope: "global" as const }
          : { scope: "workspace" as const, workspaceId: scopeId.value }),
      }) as Promise<SessionsOverviewEntry[]>,
    // A short page is the last page — the standard contract, and it means the
    // server never has to carry a total just so the client can stop.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
  });

  const entries = computed<SessionsOverviewEntry[]>(
    () => query.data.value?.pages.flat() ?? [],
  );

  return { query, entries };
}
