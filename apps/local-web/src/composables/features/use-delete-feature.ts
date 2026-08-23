import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateFeatureViews } from "./feature-keys.js";

export function useDeleteFeature() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspaceId: string; featureId: string }) =>
      vynel.features.remove(input.workspaceId, input.featureId),
    onSuccess: () => invalidateFeatureViews(queryClient),
  });
}
