import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateWorkspaceApps } from "./workspace-app-keys.js";

/** Remove an app from the workspace — the daemon stops it first if running. */
export function useRemoveApp() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      appId,
    }: {
      workspaceId: string;
      appId: string;
    }) => vynel.workspaceApps.remove(workspaceId, appId),
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateWorkspaceApps(queryClient, workspaceId),
  });
}
