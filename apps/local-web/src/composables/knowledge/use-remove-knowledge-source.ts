import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Remove a knowledge source (stops watching + drops its index). Needs a
 *  workspace anchor like every knowledge route. */
export function useRemoveKnowledgeSource() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { anchorWorkspaceId: string; sourceId: string }) =>
      vynel.knowledge.removeSource(input.anchorWorkspaceId, input.sourceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}
