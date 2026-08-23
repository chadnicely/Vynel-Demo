import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidatePhaseViews } from "./phase-keys.js";

export function useDeletePhase() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspaceId: string; phaseId: string }) =>
      vynel.phases.remove(input.workspaceId, input.phaseId),
    onSuccess: () => invalidatePhaseViews(queryClient),
  });
}
