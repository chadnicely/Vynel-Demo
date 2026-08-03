import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

/** Rename the workspace or its persona (Customize section). The persona name
 *  is load-bearing beyond display — @-mentions and report labels match on it
 *  — so the whole workspace list refreshes, not just one row. */
export function useUpdateWorkspace() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      workspaceId: string;
      name?: string;
      managerName?: string;
    }) =>
      vynel.workspaces.update(input.workspaceId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.managerName !== undefined
          ? { managerName: input.managerName }
          : {}),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}
