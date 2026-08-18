import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { CreateDirectoryRequest } from "@vynel/contracts/workspaces/workspace-http";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

/** The filesystem browser's "New folder". Every directory listing is
 *  invalidated on settle — the parent re-lists with the new folder, and a
 *  picker of the other flavour (files on / off) that had the same folder cached
 *  can't show a stale view either. */
export function useCreateDirectory() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDirectoryRequest) =>
      vynel.workspaces.createDirectory(input),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.directoryListings() }),
  });
}
