import type { QueryClient } from "@tanstack/vue-query";

export const sshServerKeys = {
  all: ["ssh-servers"] as const,
  list: ["ssh-servers", "list"] as const,
};

// Every ssh-servers mutation lands in a list refresh — a successful test
// stamps lastConnectedAt (and the first host-key fingerprint) server-side,
// so the rows re-read the daemon's truth instead of guessing.
export function invalidateSshServers(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: sshServerKeys.all });
}
