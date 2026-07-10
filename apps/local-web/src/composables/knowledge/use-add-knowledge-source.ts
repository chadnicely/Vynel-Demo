import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Register a directory or single file as a knowledge source. The route is
 *  workspace-anchored even for a GLOBAL source — `anchorWorkspaceId` names the
 *  anchor; `scope` decides where the source actually lives. */
export function useAddKnowledgeSource() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      anchorWorkspaceId: string;
      absolutePath: string;
      scope: "workspace" | "global";
    }) =>
      vynel.knowledge.addSource(input.anchorWorkspaceId, {
        absolutePath: input.absolutePath,
        scope: input.scope,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}
