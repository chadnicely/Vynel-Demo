import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AppEnvEntry } from "@vynel/contracts/apps/app-http";
import { useVynel } from "../use-vynel.js";
import { workspaceAppKeys } from "./workspace-app-keys.js";

/** Save the FULL desired env entry set — the API rewrites the file
 *  line-preservingly (comments survive; removed keys go). */
export function useUpdateAppEnv() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      appId,
      entries,
    }: {
      workspaceId: string;
      appId: string;
      entries: AppEnvEntry[];
    }) => vynel.workspaceApps.updateEnv(workspaceId, appId, { entries }),
    onSettled: (_data, _error, { workspaceId, appId }) =>
      queryClient.invalidateQueries({
        queryKey: workspaceAppKeys.env(workspaceId, appId),
      }),
  });
}
