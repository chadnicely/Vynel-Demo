import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

export function useKnowledgeSources(
  workspaceId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => ["knowledge", "sources", toValue(workspaceId)]),
    queryFn: () => vynel.knowledge.listSources(toValue(workspaceId)),
    select: (response) => response.sources,
    enabled,
  });
}
