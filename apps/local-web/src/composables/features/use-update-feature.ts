import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidateFeatureViews } from "./feature-keys.js";

type UpdateFeaturePatch = Parameters<VynelClient["features"]["update"]>[2];

/** Patch a feature — status moves, edits, and the phase link (`phaseId:
 *  null` unlinks it from its phase). */
export function useUpdateFeature() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      featureId,
      ...patch
    }: { workspaceId: string; featureId: string } & UpdateFeaturePatch) =>
      vynel.features.update(workspaceId, featureId, patch),
    onSuccess: () => invalidateFeatureViews(queryClient),
  });
}
