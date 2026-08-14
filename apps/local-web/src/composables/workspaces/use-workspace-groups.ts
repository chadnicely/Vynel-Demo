import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

// Menu-tree folders (workspace redesign Arc 2b): the list query + the four
// mutations the tree needs. Every mutation invalidates BOTH the groups and
// the workspaces lists — membership lives on the workspace rows, so a move
// or a folder delete changes both result sets.
export function useWorkspaceGroups() {
  const vynel = useVynel();
  return useQuery({
    queryKey: workspaceKeys.groups(),
    // The groups routes carry real response schemas, so the generated SDK
    // types the result — no contracts cast needed.
    queryFn: () => vynel.workspaces.listGroups(),
  });
}

export function useWorkspaceGroupMutations() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.groups() });
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() });
  };

  const createGroup = useMutation({
    mutationFn: (name: string) => vynel.workspaces.createGroup({ name }),
    onSuccess: refresh,
  });

  const renameGroup = useMutation({
    mutationFn: (input: { groupId: string; name: string }) =>
      vynel.workspaces.renameGroup(input.groupId, { name: input.name }),
    onSuccess: refresh,
  });

  const deleteGroup = useMutation({
    mutationFn: (groupId: string) => vynel.workspaces.deleteGroup(groupId),
    onSuccess: refresh,
  });

  const moveWorkspace = useMutation({
    mutationFn: (input: { workspaceId: string; groupId: string | null }) =>
      vynel.workspaces.setGroup(input.workspaceId, { groupId: input.groupId }),
    onSuccess: refresh,
  });

  return { createGroup, renameGroup, deleteGroup, moveWorkspace };
}
