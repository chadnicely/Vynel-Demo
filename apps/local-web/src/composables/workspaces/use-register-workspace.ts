import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

export interface RegisterWorkspaceInput {
  name: string;
  /** An EXISTING directory on disk to register as the workspace. */
  directory: string;
}

export function useRegisterWorkspace() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterWorkspaceInput) =>
      vynel.workspaces.register(input),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}
