import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";
import { taskKeys } from "./task-keys.js";

/** The tasks a SURFACE owns — strict per scope (the channels convention): a
 *  workspace menu lists only its own rows via the server-filtered workspace
 *  route; the global menu only null-workspace rows. The user route carries no
 *  scope filter, so the global shelf narrows client-side. `useTasks` stays
 *  the user-wide read for the panel, Home card, and dialogs. */
export function useTasksInScope(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return taskKeys.listInScope(
        surface.kind === "workspace" ? surface.workspaceId : "global",
      );
    }),
    queryFn: async () => {
      const surface = toValue(scope);
      if (surface.kind === "workspace")
        return vynel.tasks.list(surface.workspaceId);
      const rows = await vynel.tasksUser.list();
      return rows.filter((row) => row.workspaceId === null);
    },
  });
}
