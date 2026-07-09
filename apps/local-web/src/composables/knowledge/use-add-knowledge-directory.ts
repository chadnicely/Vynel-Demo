import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Register a directory as a knowledge source. The route is workspace-anchored
 *  even for a GLOBAL source — `anchorWorkspaceId` names the anchor; `scope`
 *  decides where the source actually lives. */
export function useAddKnowledgeDirectory() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      anchorWorkspaceId: string;
      absolutePath: string;
      scope: "workspace" | "global";
    }) =>
      vynel.knowledge.addDirectory(input.anchorWorkspaceId, {
        absolutePath: input.absolutePath,
        scope: input.scope,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}
