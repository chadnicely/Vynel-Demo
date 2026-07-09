import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { SectionScope } from "../../components/sections/section-scope.js";

// The sources visible from a surface. A workspace lists its own + the user's
// global sources (the route's scope fusion). The GLOBAL surface has no single
// anchor — the route is workspace-anchored — so it merges every workspace's
// view and dedupes (global sources appear in each).
export function useKnowledgeSourcesInScope(scope: SectionScope) {
  const vynel = useVynel();
  return useQuery({
    queryKey:
      scope.kind === "workspace"
        ? ["knowledge", "sources", scope.workspaceId]
        : ["knowledge", "sources", "all"],
    queryFn: async () => {
      if (scope.kind === "workspace") {
        const response = await vynel.knowledge.listSources(scope.workspaceId);
        return response.sources;
      }
      const workspaces = await vynel.workspaces.list();
      const perWorkspace = await Promise.all(
        workspaces
          .filter((row) => !row.isArchived)
          .map((row) => vynel.knowledge.listSources(row.id)),
      );
      const byId = new Map(
        perWorkspace.flatMap((response) =>
          response.sources.map((source) => [source.id, source] as const),
        ),
      );
      return [...byId.values()];
    },
  });
}
