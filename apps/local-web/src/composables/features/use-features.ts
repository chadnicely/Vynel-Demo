import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { featureKeys } from "./feature-keys.js";

/** A workspace's features — workspace-only by design (a feature belongs to a
 *  project's build plan, so unlike Tasks there is no global twin). */
export function useFeatures(workspaceId: MaybeRefOrGetter<string>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => featureKeys.list(toValue(workspaceId))),
    queryFn: () => vynel.features.list(toValue(workspaceId)),
  });
}
