import { useQuery } from "@tanstack/vue-query";
import type { MaybeRefOrGetter } from "vue";
import { useVynel } from "../use-vynel.js";
import { dashboardKeys } from "./dashboard-keys.js";

export function useDashboardOverview(
  /** Poll cadence — Home passes 5s while a turn runs so task completions land
   *  live (the SessionsView cadence pattern); false = no poll. */
  refetchInterval?: MaybeRefOrGetter<number | false>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: dashboardKeys.overview(),
    queryFn: () => vynel.dashboard.getOverview(),
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
  });
}
