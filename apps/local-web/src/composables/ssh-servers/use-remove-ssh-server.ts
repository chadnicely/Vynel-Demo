import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateSshServers } from "./ssh-server-keys.js";

/** Remove a server and its sealed credential — re-adding needs the secret
 *  typed in again (there is deliberately no credential-read surface). */
export function useRemoveSshServer() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { serverId: string }) =>
      vynel.sshServers.remove(input.serverId),
    onSuccess: () => invalidateSshServers(queryClient),
  });
}
