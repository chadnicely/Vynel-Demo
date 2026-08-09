import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** Install a marketplace item on the given SURFACE: the global menu
 *  installs at USER scope (`marketplaceUser.install`), a workspace drawer
 *  at workspace scope. The daemon dispatches cloud vs. bundled (and skill
 *  vs. agent) by itemId — the UI only names the item. A user-scope install
 *  also flips every workspace shelf's annotation, so BOTH surfaces'
 *  marketplace reads are refreshed (prefix invalidation), along with the
 *  installed-skills panel and every Agents shelf (an agent install must
 *  show up there without a reload). */
export function useInstallMarketplaceItem() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scope: SectionScope;
      itemId: string;
      /** Values for an mcp item's declared configuration fields (the
       *  configure dialog's output). Secrets — sent once, never kept. */
      mcpConfigurationValues?: Record<string, string>;
      /** Plugin installs carry the UI's explicit consent (plugins run
       *  code); the session tool cannot send it. */
      acceptPluginExecution?: true;
    }) =>
      input.scope.kind === "global"
        ? vynel.marketplaceUser.install({
            itemId: input.itemId,
            ...(input.mcpConfigurationValues !== undefined
              ? { mcpConfigurationValues: input.mcpConfigurationValues }
              : {}),
            ...(input.acceptPluginExecution !== undefined
              ? { acceptPluginExecution: input.acceptPluginExecution }
              : {}),
          })
        : vynel.marketplace.install(input.scope.workspaceId, {
            itemId: input.itemId,
            scope: "workspace",
            ...(input.mcpConfigurationValues !== undefined
              ? { mcpConfigurationValues: input.mcpConfigurationValues }
              : {}),
            ...(input.acceptPluginExecution !== undefined
              ? { acceptPluginExecution: input.acceptPluginExecution }
              : {}),
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketplace", "items"] });
      queryClient.invalidateQueries({ queryKey: ["skills", "installed"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
