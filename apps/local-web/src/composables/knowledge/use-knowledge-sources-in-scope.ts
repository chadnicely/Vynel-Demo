import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { SectionScope } from "../../components/sections/section-scope.js";

// The sources visible from a surface. A workspace lists its own + the user's
// global sources (the workspace route's scope fusion); the GLOBAL surface
// lists ONLY the user's global sources, off its own user-scoped route —
// where you are IS the scope (the channels convention).
export function useKnowledgeSourcesInScope(scope: SectionScope) {
  const vynel = useVynel();
  return useQuery({
    queryKey:
      scope.kind === "workspace"
        ? ["knowledge", "sources", scope.workspaceId]
        : ["knowledge", "sources", "global"],
    queryFn: async () => {
      const response =
        scope.kind === "workspace"
          ? await vynel.knowledge.listSources(scope.workspaceId)
          : await vynel.knowledgeUser.listSources();
      return response.sources;
    },
  });
}
