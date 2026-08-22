import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

type CloneRepositoryInput = Parameters<VynelClient["workspaces"]["clone"]>[0];

/** "Create from a repository": git clone into a fresh folder inside the
 *  chosen one, registered as a workspace — the repository IS the history. */
export function useCloneRepositoryWorkspace() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CloneRepositoryInput) => vynel.workspaces.clone(input),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}
