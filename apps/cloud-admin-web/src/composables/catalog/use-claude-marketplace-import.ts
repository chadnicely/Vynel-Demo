import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminCatalogKeys } from "./catalog-keys.js";

/** The marketplace-aggregation review queue: inspect clones the repo at
 *  HEAD and answers the plugin list (stateless — nothing stored); import
 *  publishes the admin-approved subset as community `plugin` items. */
export type ClaudeMarketplaceInspection = {
  repoUrl: string;
  pinnedSha: string;
  marketplaceName: string;
  ownerName: string | null;
  description: string | null;
  plugins: Array<{
    pluginName: string;
    description: string | null;
    version: string | null;
    category: string | null;
    proposedItemId: string;
    alreadyPublished: boolean;
  }>;
};

export type ClaudeMarketplaceImportResponse = {
  items: Array<{
    itemId: string;
    pluginName: string;
    outcome:
      | "published"
      | "skipped-already-published"
      | "invalid-name"
      | "invalid-metadata"
      | "failed";
    detail: string | null;
  }>;
};

export function useInspectClaudeMarketplace() {
  return useMutation({
    mutationFn: (input: { url: string }) =>
      adminApiFetch<ClaudeMarketplaceInspection>("/admin/catalog/inspect-claude-marketplace", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useImportClaudeMarketplace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      url: string;
      pinnedSha: string;
      marketplaceName: string;
      ownerName: string | null;
      selected: ClaudeMarketplaceInspection["plugins"];
    }) =>
      adminApiFetch<ClaudeMarketplaceImportResponse>("/admin/catalog/import-claude-marketplace", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          selected: input.selected.map(({ pluginName, description, version, category }) => ({
            pluginName,
            description,
            version,
            category,
          })),
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminCatalogKeys.all }),
  });
}
