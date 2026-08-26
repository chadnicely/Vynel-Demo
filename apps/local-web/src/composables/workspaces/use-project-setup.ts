import { useQuery } from "@tanstack/vue-query";
import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useVynel } from "../use-vynel.js";

// What a project's folder already answers for itself — its repository, its
// .env, its database. "Finish setting up" asks only what this cannot see.
export function useProjectSetup(workspaceId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const id = computed(() => toValue(workspaceId));
  return useQuery({
    queryKey: ["workspaces", "setup", id],
    enabled: computed(() => id.value !== null),
    queryFn: () => vynel.workspaces.getSetup(id.value!),
    staleTime: 15_000,
  });
}
