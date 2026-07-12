import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { notebookKeys } from "./notebook-keys.js";
import type { SectionScope } from "../../components/sections/section-scope.js";

/** One playbook with its full body — fetched lazily (a verified book's body
 *  lives on the server; the shelf listing carries only its one-liner). */
export function usePlaybook(
  playbookId: MaybeRefOrGetter<string | null>,
  scope: SectionScope,
) {
  const vynel = useVynel();
  const workspaceId = scope.kind === "workspace" ? scope.workspaceId : null;
  return useQuery({
    queryKey: computed(() =>
      notebookKeys.playbook(toValue(playbookId) ?? "none", workspaceId),
    ),
    queryFn: () =>
      vynel.notebook.getPlaybook(
        toValue(playbookId)!,
        workspaceId !== null ? { workspaceId } : undefined,
      ),
    enabled: computed(() => toValue(playbookId) !== null),
  });
}
