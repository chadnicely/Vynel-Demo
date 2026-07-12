import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** Uninstall a marketplace item on the given SURFACE: the global menu
 *  removes the USER-scoped installation (`marketplaceUser.uninstall`), a
 *  workspace drawer that workspace's (the daemon dispatches skill vs.
 *  agent by the installed kind — the UI only names the item). A user-scope
 *  removal also flips every workspace shelf's annotation, so BOTH
 *  surfaces' marketplace reads are refreshed (prefix invalidation), along
 *  with the installed-skills panel. */
export function useUninstallMarketplaceItem() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { scope: SectionScope; itemId: string }) =>
      input.scope.kind === "global"
        ? vynel.marketplaceUser.uninstall({ itemId: input.itemId })
        : vynel.marketplace.uninstall(input.scope.workspaceId, {
            itemId: input.itemId,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketplace", "items"] });
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}
