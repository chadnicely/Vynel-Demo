import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** The agents visible on a SURFACE: a workspace drawer lists user-scope ∪
 *  that workspace's agents (what its sessions can delegate to); the global
 *  menu lists user-scope agents only. Keyed under the `["agents"]` prefix so
 *  a marketplace install/uninstall (either surface) refreshes every shelf. */
export function useAgents(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return [
        "agents",
        "list",
        surface.kind === "workspace" ? surface.workspaceId : "user",
      ];
    }),
    queryFn: () => {
      const surface = toValue(scope);
      return surface.kind === "workspace"
        ? vynel.agents.list({ workspaceId: surface.workspaceId })
        : vynel.agents.list();
    },
  });
}
