import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateServerInstalls } from "./server-install-keys.js";

/** Forget an install locally — the server itself is left untouched (v1 has no
 *  remote uninstall, so this never surprises the user's machine). */
export function useRemoveServerInstall() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { installId: string }) => vynel.serverInstall.remove(input.installId),
    onSuccess: () => invalidateServerInstalls(queryClient),
  });
}
