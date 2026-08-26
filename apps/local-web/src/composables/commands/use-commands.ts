import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";
import { commandsKeys } from "./commands-keys.js";

/** The slash commands a SURFACE owns — the workspace's own `.claude/commands`,
 *  or the user folder on the global menu, so the list matches disk. `resolved`
 *  switches to what is runnable there (user ∪ workspace): the "/" picker's
 *  question. The two answers are cached apart. */
export function useCommands(
  scope: MaybeRefOrGetter<SectionScope>,
  options: { resolved?: boolean } = {},
) {
  const vynel = useVynel();
  const isResolved = options.resolved === true;
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return commandsKeys.list(
        isResolved ? "resolved" : "owned",
        surface.kind === "workspace" ? surface.workspaceId : "user",
      );
    }),
    queryFn: async () => {
      const surface = toValue(scope);
      // The global surface resolves its own user folder and nothing else.
      if (surface.kind !== "workspace") {
        return (await vynel.commandsUser.list()).commands;
      }
      const response = isResolved
        ? await vynel.commands.listResolved({ workspaceId: surface.workspaceId })
        : await vynel.commands.list(surface.workspaceId);
      return response.commands;
    },
  });
}
