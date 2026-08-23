import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { phaseKeys } from "./phase-keys.js";

/** A workspace's build phases — workspace-only by design (a phase orders a
 *  project's build, so unlike Tasks there is no global twin). The API returns
 *  them in build order (`orderIndex`). */
export function usePhases(workspaceId: MaybeRefOrGetter<string>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => phaseKeys.list(toValue(workspaceId))),
    queryFn: () => vynel.phases.list(toValue(workspaceId)),
  });
}
