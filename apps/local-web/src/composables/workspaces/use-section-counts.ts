import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

// The drilled menu's per-row numbers (the canvas's `Sessions 13` / `Agents 3`
// / `Skills 7` / `Rules 2`). One request per scope answers the whole menu —
// the alternative was seventeen list calls just to render a decoration.
//
// A section absent from the map renders NO number: the engine only reports
// counts it can answer honestly, and a fabricated 0 reads as "empty".
export function useSectionCounts(workspaceId: Ref<string | null>) {
  const vynel = useVynel();
  const query = useQuery({
    queryKey: computed(() => ["section-counts", workspaceId.value] as const),
    queryFn: () => {
      const id = workspaceId.value;
      return id === null
        ? vynel.sectionCounts.getGlobal()
        : vynel.sectionCountsWorkspace.get(id);
    },
    // A menu decoration — cheap to be a little stale, wasteful to refetch on
    // every scope flip.
    staleTime: 30_000,
  });

  const countBySectionId = computed<Record<string, number>>(
    () => query.data.value?.counts ?? {},
  );

  return { countBySectionId };
}
