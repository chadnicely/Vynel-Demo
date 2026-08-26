import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

// "Done — start building" — stamps the project as set up, which is what moves
// it out of the sidebar's NEEDS SETUP section (Chad, 2026-08-25).
//
// The workspace LIST is what the sidebar buckets from, so that is the key to
// invalidate — the row moves section on the next read, without a reload.
export function useMarkSetupComplete() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => vynel.workspaces.markSetupComplete(workspaceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}
