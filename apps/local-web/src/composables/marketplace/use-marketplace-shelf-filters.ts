import { computed, ref, type ComputedRef } from "vue";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";

/** The shelf's client-side filter state — search, kind pills, source chips,
 *  installed toggle — composed with AND over the full list (the curated
 *  catalog is small; nothing to debounce or page). One home so the section
 *  stays a layout file. */
export type KindFilter = "all" | "skill" | "agent" | "plugin";

export const KIND_FILTERS: Array<{ value: KindFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "skill", label: "Skills" },
  { value: "agent", label: "Agents" },
  { value: "plugin", label: "Plugins" },
];

function matchesSearch(item: MarketplaceItem, query: string): boolean {
  return [item.displayName, item.oneLineDescription, item.category].some((field) =>
    field.toLowerCase().includes(query),
  );
}

export function useMarketplaceShelfFilters(items: ComputedRef<MarketplaceItem[]>) {
  const searchText = ref("");
  const kindFilter = ref<KindFilter>("all");
  const showInstalledOnly = ref(false);

  // Source chips render only once a third-party marketplace contributes
  // rows — a Vynel-only shelf stays uncluttered. 'vynel' = bundled + hub.
  const sourceFilter = ref<"all" | "vynel" | string>("all");
  const marketplaceNames = computed(() => [
    ...new Set(
      items.value.flatMap((item) =>
        item.source.kind === "claude-marketplace" ? [item.source.marketplaceName] : [],
      ),
    ),
  ]);

  function matchesSource(item: MarketplaceItem): boolean {
    if (sourceFilter.value === "all") return true;
    if (sourceFilter.value === "vynel") return item.source.kind === "vynel-catalog";
    return (
      item.source.kind === "claude-marketplace" &&
      item.source.marketplaceName === sourceFilter.value
    );
  }

  const visibleItems = computed(() => {
    const query = searchText.value.trim().toLowerCase();
    return items.value.filter(
      (item) =>
        (kindFilter.value === "all" || item.kind === kindFilter.value) &&
        matchesSource(item) &&
        (!showInstalledOnly.value || item.installStatus.kind === "installed") &&
        (query.length === 0 || matchesSearch(item, query)),
    );
  });

  function clearFilters() {
    searchText.value = "";
    kindFilter.value = "all";
    sourceFilter.value = "all";
    showInstalledOnly.value = false;
  }

  return {
    searchText,
    kindFilter,
    showInstalledOnly,
    sourceFilter,
    marketplaceNames,
    visibleItems,
    clearFilters,
  };
}
