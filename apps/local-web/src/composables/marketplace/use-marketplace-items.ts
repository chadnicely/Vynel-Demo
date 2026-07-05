import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

export function useMarketplaceItems(
  workspaceId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => ["marketplace", "items", toValue(workspaceId)]),
    queryFn: () => vynel.marketplace.listItems(toValue(workspaceId)),
    enabled,
  });
}
