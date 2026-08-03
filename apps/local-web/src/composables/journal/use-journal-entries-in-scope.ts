import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";
import { journalKeys } from "./journal-keys.js";

/** The journal entries a SURFACE owns — strict per scope (the channels
 *  convention): a workspace menu lists only its own rows via the
 *  server-filtered workspace route; the global menu only null-workspace rows.
 *  The user route carries no scope filter, so the global shelf narrows
 *  client-side. */
export function useJournalEntriesInScope(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return journalKeys.listInScope(
        surface.kind === "workspace" ? surface.workspaceId : "global",
      );
    }),
    queryFn: async () => {
      const surface = toValue(scope);
      if (surface.kind === "workspace")
        return vynel.journal.list(surface.workspaceId);
      const rows = await vynel.journalUser.list();
      return rows.filter((row) => row.workspaceId === null);
    },
  });
}
