import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateDesktopAccess } from "./desktop-access-keys.js";

/** Revoke Claude's access to one desktop app — effective on the next desktop
 *  tool call (enforcement re-reads grants per action). Re-granting always goes
 *  back through an approval card. */
export function useRevokeDesktopAccess() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { appName: string }) => vynel.desktopAccess.revoke(input.appName),
    onSuccess: () => invalidateDesktopAccess(queryClient),
  });
}
