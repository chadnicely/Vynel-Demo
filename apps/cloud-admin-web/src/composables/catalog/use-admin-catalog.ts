import { useQuery } from "@tanstack/vue-query";
import type { HubAdminCatalogItem } from "@vynel/contracts/hub/admin";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminCatalogKeys } from "./catalog-keys.js";

/** The FULL catalog — every status, every version. There is no per-item
 *  endpoint; the detail view reads its item out of this same cache entry. */
export function useAdminCatalog() {
  return useQuery({
    queryKey: adminCatalogKeys.list(),
    queryFn: async () =>
      (await adminApiFetch<{ items: HubAdminCatalogItem[] }>("/admin/catalog"))
        .items,
  });
}
