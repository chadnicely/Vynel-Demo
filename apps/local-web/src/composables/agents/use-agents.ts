import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** The agents a SURFACE owns — a workspace's own, or the user's on the global
 *  menu. `resolved` switches to what a session THERE can delegate to (user ∪
 *  workspace): the "@" picker's question, not the menu's. The two answers are
 *  cached apart, or the picker would be served the menu's shorter list.
 *  Keyed under `["agents"]` so a marketplace install refreshes every shelf. */
export function useAgents(
  scope: MaybeRefOrGetter<SectionScope>,
  options: { resolved?: boolean } = {},
) {
  const vynel = useVynel();
  const isResolved = options.resolved === true;
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return [
        "agents",
        isResolved ? "resolved" : "list",
        surface.kind === "workspace" ? surface.workspaceId : "user",
      ];
    }),
    queryFn: () => {
      const surface = toValue(scope);
      // No workspace to union in — the user shelf IS what resolves globally, so
      // both modes read the one route rather than fetching the same rows twice
      // (same short-circuit as use-commands / use-installed-skills).
      if (surface.kind !== "workspace") return vynel.agents.list();
      const query = { workspaceId: surface.workspaceId };
      return isResolved
        ? vynel.agents.listResolved(query)
        : vynel.agents.list(query);
    },
  });
}
