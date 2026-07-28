import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { invalidateServerInstalls } from "./server-install-keys.js";

type StartServerInstallInput = Parameters<VynelClient["serverInstall"]["start"]>[0];

/** Begin provisioning a server. Returns as soon as the row exists — the
 *  pipeline continues in the background and the list poll shows its steps. */
export function useStartServerInstall() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartServerInstallInput) => vynel.serverInstall.start(input),
    onSuccess: () => invalidateServerInstalls(queryClient),
  });
}
