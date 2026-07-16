import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { invalidateWorkspaceApps } from "./workspace-app-keys.js";

type AddAppInput = Parameters<VynelClient["workspaceApps"]["add"]>[1];

/** Register a runnable app on the workspace. */
export function useAddApp() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      ...input
    }: { workspaceId: string } & AddAppInput) =>
      vynel.workspaceApps.add(workspaceId, input),
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateWorkspaceApps(queryClient, workspaceId),
  });
}
