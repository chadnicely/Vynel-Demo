import { computed } from "vue";
import { BASELINE_CATALOG_CATEGORIES } from "@vynel/contracts/marketplace/catalog-categories";
import { useAdminCatalog } from "./use-admin-catalog.js";

/** The category vocabulary the select offers: the contracts baseline unioned
 *  with every category already live in the catalog (admin-defined, global to
 *  all users), sorted. One home — CategorySelect consumes it directly. */
export function useCatalogCategories() {
  const catalogQuery = useAdminCatalog();
  return computed(() => {
    const categories = new Set<string>(BASELINE_CATALOG_CATEGORIES);
    for (const item of catalogQuery.data.value ?? []) {
      if (item.category !== "") categories.add(item.category);
    }
    return [...categories].sort();
  });
}
