import { type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SshServerResponse } from "@vynel/contracts/ssh/ssh-http";
import { useVynel } from "../use-vynel.js";
import { sshServerKeys } from "./ssh-server-keys.js";

/** The user's SSH servers, both scopes together — sections filter client-side
 *  (the channels convention). Servers change rarely, so a slow refresh keeps
 *  "last connected" honest without polling pressure. */
export function useSshServers(enabled: MaybeRefOrGetter<boolean>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: sshServerKeys.list,
    // The contracts type is the house name for this row shape (its own note).
    queryFn: async () => (await vynel.sshServers.list()) as SshServerResponse[],
    enabled,
    refetchInterval: 30_000,
  });
}
