import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidateFeatureViews } from "./feature-keys.js";

type CreateFeatureBody = Parameters<VynelClient["features"]["create"]>[1];

export function useCreateFeature() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      ...body
    }: { workspaceId: string } & CreateFeatureBody) =>
      vynel.features.create(workspaceId, body),
    onSuccess: () => invalidateFeatureViews(queryClient),
  });
}
