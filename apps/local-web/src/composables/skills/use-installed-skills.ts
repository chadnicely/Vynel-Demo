import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** Skills installed INTO a surface — a workspace's own installs, or the user's
 *  on the global menu, so the list matches what is on disk there. `resolved`
 *  switches to what a session there can reach (user ∪ workspace): the "/"
 *  picker's question. Cached apart from the menu's answer. Keyed under
 *  `["skills", "installed"]` so a marketplace install refreshes every shelf. */
export function useInstalledSkills(
  scope: MaybeRefOrGetter<SectionScope>,
  options: { resolved?: boolean } = {},
) {
  const vynel = useVynel();
  const isResolved = options.resolved === true;
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return [
        "skills",
        "installed",
        isResolved ? "resolved" : "owned",
        surface.kind === "workspace" ? surface.workspaceId : "user",
      ];
    }),
    queryFn: () => {
      const surface = toValue(scope);
      // The global surface has no workspace to union in — its user-scope
      // shelf IS what resolves there, so both modes read the same route.
      if (surface.kind !== "workspace") return vynel.skillsUser.listInstalled();
      return isResolved
        ? vynel.skills.listInstalledResolved(surface.workspaceId)
        : vynel.skills.listInstalled(surface.workspaceId);
    },
  });
}
