import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateWorkspaceApps } from "./workspace-app-keys.js";

/** Start an app. A 409 ("already running") surfaces through the mutation's
 *  error; the settle-time invalidation re-syncs the row either way. */
export function useStartApp() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      appId,
    }: {
      workspaceId: string;
      appId: string;
    }) => vynel.workspaceApps.start(workspaceId, appId),
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateWorkspaceApps(queryClient, workspaceId),
  });
}
