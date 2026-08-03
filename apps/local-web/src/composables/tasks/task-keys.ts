import type { QueryClient } from "@tanstack/vue-query";
import { dashboardKeys } from "../dashboard/dashboard-keys.js";

export const taskKeys = {
  all: ["tasks"] as const,
  list: () => [...taskKeys.all, "list"] as const,
  listInScope: (surfaceKey: string) =>
    [...taskKeys.all, "list", surfaceKey] as const,
};

// Tasks show up on two surfaces (the tasks list + the Home overview card) —
// every mutation refreshes both so neither goes stale.
export function invalidateTaskViews(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    queryClient.invalidateQueries({ queryKey: dashboardKeys.overview() }),
  ]);
}
