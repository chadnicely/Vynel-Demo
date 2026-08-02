import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** Installed skills on a SURFACE: a workspace drawer lists user-scope ∪ that
 *  workspace's installs (the workspace route's fusion); the global menu lists
 *  user-scope installs only. Keyed under `["skills", "installed"]` so a
 *  marketplace install/uninstall refreshes every shelf. */
export function useInstalledSkills(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return [
        "skills",
        "installed",
        surface.kind === "workspace" ? surface.workspaceId : "user",
      ];
    }),
    queryFn: () => {
      const surface = toValue(scope);
      return surface.kind === "workspace"
        ? vynel.skills.listInstalled(surface.workspaceId)
        : vynel.skillsUser.listInstalled();
    },
  });
}
