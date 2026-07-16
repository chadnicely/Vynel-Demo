import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateSshServers } from "./ssh-server-keys.js";

/** Probe a server's connection. Settled (not just success) refreshes the
 *  list: a passing test stamps lastConnectedAt and pins the first host-key
 *  fingerprint, and even a failure may have recorded state worth re-reading. */
export function useTestSshConnection() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { serverId: string }) =>
      vynel.sshServers.testConnection(input.serverId),
    onSettled: () => invalidateSshServers(queryClient),
  });
}
