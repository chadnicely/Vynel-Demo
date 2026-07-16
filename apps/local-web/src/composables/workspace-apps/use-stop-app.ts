import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateWorkspaceApps } from "./workspace-app-keys.js";

/** Stop an app — idempotent on the daemon side, so a stale "running" row
 *  never turns Stop into an error. */
export function useStopApp() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      appId,
    }: {
      workspaceId: string;
      appId: string;
    }) => vynel.workspaceApps.stop(workspaceId, appId),
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateWorkspaceApps(queryClient, workspaceId),
  });
}
