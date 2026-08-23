import type { QueryClient } from "@tanstack/vue-query";

export const featureKeys = {
  all: ["features"] as const,
  list: (workspaceId: string) =>
    [...featureKeys.all, "list", workspaceId] as const,
  // One feature's full big-form description (the list carries only a preview).
  detail: (featureId: string) =>
    [...featureKeys.all, "detail", featureId] as const,
};

// One surface today (the workspace Features section); a mutation refreshes
// the list and any open detail together.
export function invalidateFeatureViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: featureKeys.all });
}
