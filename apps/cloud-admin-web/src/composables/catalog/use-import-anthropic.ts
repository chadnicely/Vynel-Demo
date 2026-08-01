import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminCatalogKeys } from "./catalog-keys.js";

/** POST /admin/catalog/import-anthropic — the hub clones the pinned
 *  anthropics/skills snapshot and publishes the manifest's items server-side.
 *  Already-published versions come back as skipped (safe to re-click);
 *  `configured: false` = the hub runs without the manifest. */
export type ImportAnthropicResponse = {
  configured: boolean;
  items?: Array<{
    itemId: string;
    version: string;
    outcome: "published" | "skipped-already-published";
    bytes: number | null;
  }>;
};

export function useImportAnthropic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      adminApiFetch<ImportAnthropicResponse>("/admin/catalog/import-anthropic", {
        method: "POST",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminCatalogKeys.all }),
  });
}
