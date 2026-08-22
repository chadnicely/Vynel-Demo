import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

type ScaffoldWorkspaceInput = Parameters<
  VynelClient["workspaces"]["scaffold"]
>[0];

/** The wizard's Finish: folder, README, git, the row and its brief in one
 *  go — then the caller opens the workspace and seeds the brief into its
 *  composer. The USER presses send. */
export function useScaffoldWorkspace() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ScaffoldWorkspaceInput) =>
      vynel.workspaces.scaffold(input),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}
