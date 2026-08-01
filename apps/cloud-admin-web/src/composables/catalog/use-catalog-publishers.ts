import { computed } from "vue";
import { useAdminCatalog } from "./use-admin-catalog.js";

export interface CatalogPublisherOption {
  id: string;
  name: string;
  tier: "verified" | "anthropic-official" | "community";
  url: string | null;
}

/** The publishers already live in the catalog, unique by id, sorted by name.
 *  Each option carries the publisher's EXACT stored fields — publishing
 *  re-upserts the publisher row verbatim, so an existing pick must never
 *  rename/re-tier it (only "+ new publisher" sends fresh values). */
export function useCatalogPublishers() {
  const catalogQuery = useAdminCatalog();
  return computed<CatalogPublisherOption[]>(() => {
    const byId = new Map<string, CatalogPublisherOption>();
    for (const item of catalogQuery.data.value ?? []) {
      if (!byId.has(item.publisherId)) {
        byId.set(item.publisherId, {
          id: item.publisherId,
          name: item.publisherName,
          tier: item.publisherTier,
          url: item.publisherUrl,
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
}
