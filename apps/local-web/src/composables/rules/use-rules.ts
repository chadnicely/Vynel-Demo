import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** The rule files a SURFACE resolves: a workspace drawer lists user ∪ that
 *  workspace's `.claude/rules` (how Claude Code loads them in a project);
 *  the global menu lists the user folder only. */
export function useRules(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return [
        "rules",
        "list",
        surface.kind === "workspace" ? surface.workspaceId : "user",
      ];
    }),
    queryFn: async () => {
      const surface = toValue(scope);
      const response =
        surface.kind === "workspace"
          ? await vynel.rules.list(surface.workspaceId)
          : await vynel.rulesUser.list();
      return response.rules;
    },
  });
}
