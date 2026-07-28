import type { QueryClient } from "@tanstack/vue-query";

export const serverInstallKeys = {
  all: ["server-installs"] as const,
  list: ["server-installs", "list"] as const,
};

// Starting or forgetting an install changes the list; provisioning progress
// arrives through the list's own fast poll (the row IS the progress surface).
export function invalidateServerInstalls(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: serverInstallKeys.all });
}
