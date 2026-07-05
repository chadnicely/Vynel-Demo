import { computed, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { sessionKeys, sessionScopeKey } from "./session-keys.js";
import type { SessionScope } from "./session-scope.js";

/** Resolves the scope's continuous single conversation (the default chat):
 *  the global root, or one workspace's continuing primary. */
export function useContinuingConversation(
  scope: MaybeRefOrGetter<SessionScope>,
) {
  const vynel = useVynel();
  const resolvedScope = computed(() => toValue(scope));
  return useQuery({
    queryKey: computed(() => [
      ...sessionKeys.all,
      "continuing",
      sessionScopeKey(resolvedScope.value),
    ]),
    queryFn: () => {
      const s = resolvedScope.value;
      return s.kind === "global"
        ? vynel.root.getContinuing()
        : vynel.chat.getContinuing(s.workspaceId);
    },
  });
}
