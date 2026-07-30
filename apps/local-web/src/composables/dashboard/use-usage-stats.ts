import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { dashboardKeys } from "./dashboard-keys.js";

// Token-usage statistics per model per day. One composable serves both
// dashboard scopes: no workspaceId = the user's whole set (global Home),
// a workspaceId = that workspace's own dashboard. Settled by the activity
// feed's turn-ended invalidation — no polling needed.
export function useUsageStats(
  days: MaybeRefOrGetter<number>,
  workspaceId?: MaybeRefOrGetter<string | null>,
) {
  const vynel = useVynel();
  const scopedWorkspaceId = () =>
    workspaceId === undefined ? null : toValue(workspaceId);
  return useQuery({
    queryKey: computed(() =>
      dashboardKeys.usage(scopedWorkspaceId() ?? "all", toValue(days)),
    ),
    queryFn: () => {
      const scope = scopedWorkspaceId();
      return scope === null
        ? vynel.dashboard.getUsage({ days: toValue(days) })
        : vynel.dashboardWorkspace.getUsage(scope, { days: toValue(days) });
    },
  });
}
