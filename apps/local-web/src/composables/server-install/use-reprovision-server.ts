import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateServerInstalls } from "./server-install-keys.js";

/** Re-ship the engine this app carries to a server that already has one — the
 *  desktop-driven update. The server's data survives; only the engine swaps. */
export function useReprovisionServer() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { installId: string }) => vynel.serverInstall.reprovision(input.installId),
    onSuccess: () => invalidateServerInstalls(queryClient),
  });
}
