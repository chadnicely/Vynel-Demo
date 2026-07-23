import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { WorkspaceAppResponse } from "@vynel/contracts/apps/app-http";
import { useVynel } from "../use-vynel.js";
import { workspaceAppKeys } from "./workspace-app-keys.js";

/** The workspace's apps with live run status — polled while the section is on
 *  screen so the status dots follow the actual processes. Accepts null (the
 *  Global scope has no apps) — the query stays idle instead of firing with an
 *  empty id. */
export function useWorkspaceApps(workspaceId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  return useQuery({
    // The sentinel can't collide with a real id (ids are uuids, and "" is
    // already used as a prop fallback elsewhere).
    queryKey: computed(() =>
      workspaceAppKeys.list(toValue(workspaceId) ?? "no-workspace"),
    ),
    // The contracts type is the house name for this row shape (its own note).
    queryFn: async () => {
      const id = toValue(workspaceId);
      // `enabled` only stops AUTOMATIC fetching — a manual refetch() would
      // still land here. Fail fast instead of calling the API with junk.
      if (id === null)
        throw new Error(
          "workspace apps were queried without a workspace — scope a workspace id first",
        );
      return (await vynel.workspaceApps.list(id)) as WorkspaceAppResponse[];
    },
    enabled: computed(() => toValue(workspaceId) !== null),
    refetchInterval: 3_000,
  });
}
