import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { invalidateSshServers } from "./ssh-server-keys.js";

type AddSshServerInput = Parameters<VynelClient["sshServers"]["add"]>[0];

/** Register a server. The credential rides this one request and is sealed
 *  server-side — no surface ever returns it. */
export function useAddSshServer() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddSshServerInput) => vynel.sshServers.add(input),
    onSuccess: () => invalidateSshServers(queryClient),
  });
}
