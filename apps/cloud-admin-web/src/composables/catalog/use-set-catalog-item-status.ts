import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { HubItemStatus } from "@vynel/contracts/hub/catalog";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminCatalogKeys } from "./catalog-keys.js";

/** Flip an item's lifecycle status (draft | published | yanked). */
export function useSetCatalogItemStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemId: string; status: HubItemStatus }) =>
      adminApiFetch<{ itemId: string; status: HubItemStatus }>(
        `/admin/catalog/${input.itemId}/status`,
        { method: "POST", body: JSON.stringify({ status: input.status }) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminCatalogKeys.all }),
  });
}
