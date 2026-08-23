import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { featureKeys } from "./feature-keys.js";

/** One feature with its FULL description — the list carries only a bounded
 *  preview, so the view/edit dialogs read through this door. Null id = the
 *  dialog is closed; the query stays off. */
export function useFeature(
  workspaceId: MaybeRefOrGetter<string>,
  featureId: MaybeRefOrGetter<string | null>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => featureKeys.detail(toValue(featureId) ?? "none")),
    queryFn: () => vynel.features.get(toValue(workspaceId), toValue(featureId)!),
    enabled: computed(() => toValue(featureId) !== null),
  });
}
