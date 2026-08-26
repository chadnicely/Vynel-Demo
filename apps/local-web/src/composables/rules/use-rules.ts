import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";
import { rulesKeys } from "./rules-keys.js";

/** The rule files a SURFACE OWNS: a workspace drawer lists that workspace's
 *  `.claude/rules`, the global menu the user folder — each list mirrors the
 *  folder on disk. A user-level rule still APPLIES to a session in a
 *  workspace; it is simply the Global menu's to show and to manage. */
export function useRules(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return rulesKeys.list(
        surface.kind === "workspace" ? surface.workspaceId : "user",
      );
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
