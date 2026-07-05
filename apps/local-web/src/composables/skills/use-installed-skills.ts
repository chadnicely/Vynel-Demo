import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

export function useInstalledSkills(
  workspaceId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => ["skills", "installed", toValue(workspaceId)]),
    queryFn: () => vynel.skills.listInstalled(toValue(workspaceId)),
    enabled,
  });
}
