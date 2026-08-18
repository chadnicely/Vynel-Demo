import type { QueryClient } from "@tanstack/vue-query";

export const planKeys = {
  all: ["plans"] as const,
  list: () => [...planKeys.all, "list"] as const,
  listInScope: (surfaceKey: string) =>
    [...planKeys.all, "list", surfaceKey] as const,
  // The execution plan of one task (the task dialog's chip).
  forTask: (taskId: string) => [...planKeys.all, "for-task", taskId] as const,
};

// One surface today (the plans section on both scopes); a mutation refreshes
// the shared list. (Tasks additionally refresh the dashboard — plans have no
// Home card yet.)
export function invalidatePlanViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: planKeys.all });
}
