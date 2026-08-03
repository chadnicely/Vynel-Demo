import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";
import { planKeys } from "./plan-keys.js";

/** The plans a SURFACE owns — strict per scope (the channels convention): a
 *  workspace menu lists only its own rows via the server-filtered workspace
 *  route; the global menu only null-workspace rows. The user route carries no
 *  scope filter, so the global shelf narrows client-side. `usePlans` stays
 *  the user-wide read for the plan viewer dialog. */
export function usePlansInScope(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return planKeys.listInScope(
        surface.kind === "workspace" ? surface.workspaceId : "global",
      );
    }),
    queryFn: async () => {
      const surface = toValue(scope);
      if (surface.kind === "workspace")
        return vynel.plans.list(surface.workspaceId);
      const rows = await vynel.plansUser.list();
      return rows.filter((row) => row.workspaceId === null);
    },
  });
}
