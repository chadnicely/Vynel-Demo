import type { QueryClient } from "@tanstack/vue-query";

export const workspaceAppKeys = {
  all: ["workspace-apps"] as const,
  list: (workspaceId: string) =>
    [...workspaceAppKeys.all, workspaceId, "list"] as const,
  logs: (workspaceId: string, appId: string) =>
    [...workspaceAppKeys.all, workspaceId, "logs", appId] as const,
};

// Every apps mutation settles into a list refresh — success and failure alike,
// so a 409 "already running" also snaps the status dots back to the daemon's
// live truth instead of leaving a stale row.
export function invalidateWorkspaceApps(
  queryClient: QueryClient,
  workspaceId: string,
) {
  return queryClient.invalidateQueries({
    queryKey: workspaceAppKeys.list(workspaceId),
  });
}
