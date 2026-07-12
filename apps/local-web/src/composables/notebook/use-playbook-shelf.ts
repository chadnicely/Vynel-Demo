import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { notebookKeys } from "./notebook-keys.js";
import type { SectionScope } from "../../components/sections/section-scope.js";

/** The merged playbook shelf as Claude sees it from a surface: verified books
 *  first, then the user's own enabled books visible from that scope. */
export function usePlaybookShelf(scope: SectionScope) {
  const vynel = useVynel();
  const workspaceId = scope.kind === "workspace" ? scope.workspaceId : null;
  return useQuery({
    queryKey: notebookKeys.playbooks(workspaceId),
    queryFn: async () => {
      const response = await vynel.notebook.listPlaybooks(
        workspaceId !== null ? { workspaceId } : undefined,
      );
      return response.playbooks;
    },
  });
}
