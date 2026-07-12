import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Uninstall a marketplace item (the daemon dispatches skill vs. agent by the
 *  installed kind — the UI only names the item). Removal flips the item's
 *  status AND drops an installed skill row, so both reads are refreshed. */
export function useUninstallMarketplaceItem() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspaceId: string; itemId: string }) =>
      vynel.marketplace.uninstall(input.workspaceId, { itemId: input.itemId }),
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
