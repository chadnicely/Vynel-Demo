import { computed, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { sessionKeys, sessionScopeKey } from "./session-keys.js";
import type { SessionScope } from "./session-scope.js";

// The opt-in history list. A workspace lists its real chat sessions; the global
// root is ONE continuous conversation with no session-list concept (the API has
// no root list endpoint), so its history is empty — the pinned "Current
// conversation" row is the only entry.
export function useSessionList(scope: MaybeRefOrGetter<SessionScope>) {
  const vynel = useVynel();
  const resolvedScope = computed(() => toValue(scope));
  return useQuery({
    queryKey: computed(() =>
      sessionKeys.list(sessionScopeKey(resolvedScope.value)),
    ),
    queryFn: () => {
      const s = resolvedScope.value;
      return s.kind === "workspace"
        ? vynel.chat.listSessions(s.workspaceId)
        : Promise.resolve([]);
    },
  });
}
