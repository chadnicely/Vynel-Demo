import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidatePhaseViews } from "./phase-keys.js";

type CreatePhaseBody = Parameters<VynelClient["phases"]["create"]>[1];

export function useCreatePhase() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, ...body }: { workspaceId: string } & CreatePhaseBody) =>
      vynel.phases.create(workspaceId, body),
    onSuccess: () => invalidatePhaseViews(queryClient),
  });
}
