import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { SectionScope } from "../../components/sections/section-scope.js";

// Memory entries visible from a surface. Entries live IN a workspace today
// (global memory is on the roadmap — the tagging/sources build in
// docs/module-notes/memory.md), so the GLOBAL surface aggregates every
// workspace's entries as the brain's overview.
export function useMemoryEntriesInScope(scope: SectionScope) {
  const vynel = useVynel();
  return useQuery({
    queryKey:
      scope.kind === "workspace"
        ? ["memory", "entries", scope.workspaceId]
        : ["memory", "entries", "all"],
    queryFn: async () => {
      // KNOWN truncation: the list route pages at 50/workspace and this read
      // takes only the first page (nextCursor ignored) — a cursor-follow is
      // the follow-up once someone's memory actually outgrows a page.
      if (scope.kind === "workspace") {
        const response = await vynel.memory.list(scope.workspaceId, {});
        return response.entries;
      }
      const workspaces = await vynel.workspaces.list();
      const perWorkspace = await Promise.all(
        workspaces
          .filter((row) => !row.isArchived)
          .map((row) => vynel.memory.list(row.id, {})),
      );
      return perWorkspace.flatMap((response) => response.entries);
    },
  });
}
