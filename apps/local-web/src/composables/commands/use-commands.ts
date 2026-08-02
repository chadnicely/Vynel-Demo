import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** The slash commands a SURFACE resolves: a workspace drawer lists user ∪
 *  that workspace's `.claude/commands`; the global menu lists the user folder
 *  only. Task 3's "/" mention menu reads the same rows. */
export function useCommands(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return [
        "commands",
        "list",
        surface.kind === "workspace" ? surface.workspaceId : "user",
      ];
    }),
    queryFn: async () => {
      const surface = toValue(scope);
      const response =
        surface.kind === "workspace"
          ? await vynel.commands.list(surface.workspaceId)
          : await vynel.commandsUser.list();
      return response.commands;
    },
  });
}
