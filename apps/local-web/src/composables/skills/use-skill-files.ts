import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";
import { skillsKeys } from "./skills-keys.js";
import { skillScopeOf, skillSurfaceKey } from "./skill-scope.js";

/** One skill's file list plus the text of the file the editor has open
 *  (SKILL.md until another is picked). Re-keyed per open file so switching
 *  files is a cache hit the second time. */
export function useSkillFiles(input: {
  scope: MaybeRefOrGetter<SectionScope>;
  skillId: MaybeRefOrGetter<string | null>;
  relativePath: MaybeRefOrGetter<string>;
}) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() =>
      skillsKeys.files(
        skillSurfaceKey(toValue(input.scope)),
        toValue(input.skillId) ?? "",
        toValue(input.relativePath),
      ),
    ),
    enabled: computed(() => toValue(input.skillId) !== null),
    queryFn: () =>
      vynel.skills.getFiles(toValue(input.skillId)!, {
        ...skillScopeOf(toValue(input.scope)),
        relativePath: toValue(input.relativePath),
      }),
  });
}
