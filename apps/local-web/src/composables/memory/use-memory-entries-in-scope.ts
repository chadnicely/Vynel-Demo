import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { SectionScope } from "../../components/sections/section-scope.js";

// Memory entries visible from a surface. A workspace lists its own entries;
// the GLOBAL surface lists ONLY the user's global (null-workspace) entries,
// off its own user-scoped route — where you are IS the scope (the channels
// convention).
export function useMemoryEntriesInScope(scope: SectionScope) {
  const vynel = useVynel();
  return useQuery({
    queryKey:
      scope.kind === "workspace"
        ? ["memory", "entries", scope.workspaceId]
        : ["memory", "entries", "global"],
    queryFn: async () => {
      // KNOWN truncation: both reads page at 50 and this takes only the
      // first page (nextCursor ignored) — a cursor-follow is the follow-up
      // once someone's memory actually outgrows a page.
      const response =
        scope.kind === "workspace"
          ? await vynel.memory.list(scope.workspaceId, {})
          : await vynel.memoryUser.list({});
      return response.entries;
    },
  });
}
