import type { QueryClient } from "@tanstack/vue-query";

export const localModelKeys = {
  all: ["local-models"] as const,
  list: ["local-models", "list"] as const,
};

// Starting, cancelling or removing changes the list; download progress arrives
// through the list's own fast poll (the row IS the progress surface).
export function invalidateLocalModels(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: localModelKeys.all });
}
