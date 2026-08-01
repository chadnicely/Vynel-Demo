import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** Update an installed skill (hub artifact) or plugin (Claude CLI
 *  delegate) to the catalog's latest version, on the same surface split as
 *  install (global menu → `marketplaceUser.update`, a workspace drawer →
 *  `marketplace.update`). The daemon rejects the other kinds. Refreshes
 *  both surfaces' marketplace reads (a user-scope update flips every
 *  workspace shelf's annotation) plus the installed-skills panel, which
 *  shows the version. */
export function useUpdateMarketplaceItem() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { scope: SectionScope; itemId: string }) =>
      input.scope.kind === "global"
        ? vynel.marketplaceUser.update({ itemId: input.itemId })
        : vynel.marketplace.update(input.scope.workspaceId, {
            itemId: input.itemId,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketplace", "items"] });
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}
