import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";
import { agentsKeys } from "./agents-keys.js";

/** The hand-authored agent files a SURFACE owns — `.claude/agents/*.md` the
 *  user wrote (never Vynel's own mirrors): the user folder on the global
 *  menu, the workspace's own in a drawer. The engine's read fuses user ∪
 *  workspace, so the drawer keeps only its own rows. */
export function useAgentFiles(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return agentsKeys.files(
        surface.kind === "workspace" ? surface.workspaceId : "user",
      );
    }),
    queryFn: async () => {
      const surface = toValue(scope);
      if (surface.kind !== "workspace") {
        return (await vynel.agents.listFiles()).agentFiles;
      }
      const response = await vynel.agents.listFiles({
        workspaceId: surface.workspaceId,
      });
      return response.agentFiles.filter((file) => file.scope === "workspace");
    },
  });
}
