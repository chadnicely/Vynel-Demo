import type { QueryClient } from "@tanstack/vue-query";

export const planKeys = {
  all: ["plans"] as const,
  list: () => [...planKeys.all, "list"] as const,
};

// One surface today (the plans section on both scopes); a mutation refreshes
// the shared list. (Tasks additionally refresh the dashboard — plans have no
// Home card yet.)
export function invalidatePlanViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: planKeys.all });
}
