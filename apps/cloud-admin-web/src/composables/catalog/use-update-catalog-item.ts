import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminCatalogKeys } from "./catalog-keys.js";

export interface CatalogItemMetadataPatch {
  displayName?: string;
  oneLineDescription?: string;
  category?: string;
  iconName?: string;
  recommendedScope?: "user" | "workspace" | null;
  minimumTier?: "basic" | "pro";
}

/** PATCH an item's metadata. The hub rejects an empty patch (400) — callers
 *  keep Save disabled until something is dirty. */
export function useUpdateCatalogItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemId: string; patch: CatalogItemMetadataPatch }) =>
      adminApiFetch<{ itemId: string }>(`/admin/catalog/${input.itemId}`, {
        method: "PATCH",
        body: JSON.stringify(input.patch),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminCatalogKeys.all }),
  });
}
