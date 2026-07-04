import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

export function useWorkspaceList() {
  const vynel = useVynel();
  return useQuery({
    queryKey: workspaceKeys.lists(),
    queryFn: () => vynel.workspaces.list(),
  });
}
