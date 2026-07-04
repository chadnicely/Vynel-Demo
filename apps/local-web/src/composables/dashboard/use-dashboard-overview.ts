import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { dashboardKeys } from "./dashboard-keys.js";

export function useDashboardOverview() {
  const vynel = useVynel();
  return useQuery({
    queryKey: dashboardKeys.overview(),
    queryFn: () => vynel.dashboard.getOverview(),
  });
}
