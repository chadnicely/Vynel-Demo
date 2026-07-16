import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { WorkspaceAppResponse } from "@vynel/contracts/apps/app-http";
import { useVynel } from "../use-vynel.js";
import { workspaceAppKeys } from "./workspace-app-keys.js";

/** The workspace's apps with live run status — polled while the section is on
 *  screen so the status dots follow the actual processes. */
export function useWorkspaceApps(workspaceId: MaybeRefOrGetter<string>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => workspaceAppKeys.list(toValue(workspaceId))),
    // The contracts type is the house name for this row shape (its own note).
    queryFn: async () =>
      (await vynel.workspaceApps.list(
        toValue(workspaceId),
      )) as WorkspaceAppResponse[],
    refetchInterval: 3_000,
  });
}
