import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

// A workspace's tag vocabulary — "context" always leads, then suggested
// defaults plus tags already in use. Drives the tag chips when adding memory.
export function useMemoryTags(workspaceId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => ["memory", "tags", toValue(workspaceId)]),
    queryFn: async () => {
      const response = await vynel.memory.listTags(toValue(workspaceId)!);
      return response.tags;
    },
    enabled: computed(() => toValue(workspaceId) !== null),
  });
}
