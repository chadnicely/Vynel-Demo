import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { phaseKeys } from "./phase-keys.js";

/** One phase with its FULL description — the list carries only a bounded
 *  preview, so the view/edit dialogs read through this door. Null id = the
 *  dialog is closed; the query stays off. */
export function usePhase(
  workspaceId: MaybeRefOrGetter<string>,
  phaseId: MaybeRefOrGetter<string | null>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => phaseKeys.detail(toValue(phaseId) ?? "none")),
    queryFn: () => vynel.phases.get(toValue(workspaceId), toValue(phaseId)!),
    enabled: computed(() => toValue(phaseId) !== null),
  });
}
