import type { QueryClient } from "@tanstack/vue-query";

export const phaseKeys = {
  all: ["phases"] as const,
  list: (workspaceId: string) => [...phaseKeys.all, "list", workspaceId] as const,
  // One phase's full big-form description (the list carries only a preview).
  detail: (phaseId: string) => [...phaseKeys.all, "detail", phaseId] as const,
};

// One surface today (the workspace Phases section); a mutation refreshes the
// list and any open detail together.
export function invalidatePhaseViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: phaseKeys.all });
}
