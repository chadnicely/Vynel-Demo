import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { SectionScope } from "../../components/sections/section-scope.js";

// The tag vocabulary of ONE vault — a workspace's, or the user's own global
// one. "context" always leads, then suggested defaults plus tags already in
// use. Drives the tag chips when adding memory.
export function useMemoryTags(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const current = toValue(scope);
      return [
        "memory",
        "tags",
        current.kind === "workspace" ? current.workspaceId : "global",
      ];
    }),
    queryFn: async () => {
      const current = toValue(scope);
      const response =
        current.kind === "workspace"
          ? await vynel.memory.listTags(current.workspaceId)
          : await vynel.memoryUser.listTags();
      return response.tags;
    },
  });
}
