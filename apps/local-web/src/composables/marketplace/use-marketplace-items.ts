import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** The marketplace shelf for one SURFACE: the global menu reads the
 *  user-level catalog (`marketplaceUser.listItems`), a workspace drawer
 *  reads that workspace's (`marketplace.listItems`). Keyed per surface so
 *  a refetch of one never serves the other's rows. */
export function useMarketplaceItems(
  scope: MaybeRefOrGetter<SectionScope>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const target = toValue(scope);
      return [
        "marketplace",
        "items",
        target.kind === "global" ? "global" : target.workspaceId,
      ];
    }),
    queryFn: () => {
      const target = toValue(scope);
      return target.kind === "global"
        ? vynel.marketplaceUser.listItems()
        : vynel.marketplace.listItems(target.workspaceId);
    },
    enabled,
  });
}
