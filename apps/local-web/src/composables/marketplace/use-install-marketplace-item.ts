import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Install a marketplace item at the given scope (defaults to the workspace,
 *  where the marketplace section lives). The daemon dispatches cloud vs.
 *  bundled by itemId — the UI only names the item. A fresh install flips the
 *  item's status AND adds an installed skill, so both reads are refreshed. */
export function useInstallMarketplaceItem() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      workspaceId: string;
      itemId: string;
      scope?: "user" | "workspace";
    }) =>
      vynel.marketplace.install(input.workspaceId, {
        itemId: input.itemId,
        scope: input.scope ?? "workspace",
      }),
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: ["marketplace", "items", input.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["skills", "installed", input.workspaceId],
      });
    },
  });
}
