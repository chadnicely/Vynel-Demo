import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { invalidateWorkspaceApps } from "./workspace-app-keys.js";

type UpdateAppPatch = Parameters<VynelClient["workspaceApps"]["update"]>[2];

/** Patch an app — name, command, folder, port. Applies on the next start. */
export function useUpdateApp() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      appId,
      ...patch
    }: { workspaceId: string; appId: string } & UpdateAppPatch) =>
      vynel.workspaceApps.update(workspaceId, appId, patch),
    onSettled: (_data, _error, { workspaceId }) =>
      invalidateWorkspaceApps(queryClient, workspaceId),
  });
}
