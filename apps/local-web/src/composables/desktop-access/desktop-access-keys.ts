import type { QueryClient } from "@tanstack/vue-query";

export const desktopAccessKeys = {
  all: ["desktop-access"] as const,
  list: ["desktop-access", "list"] as const,
};

export function invalidateDesktopAccess(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: desktopAccessKeys.all });
}
