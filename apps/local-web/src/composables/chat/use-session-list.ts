import { computed, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { sessionKeys, sessionScopeKey } from "./session-keys.js";
import type { SessionScope } from "./session-scope.js";

export function useSessionList(scope: MaybeRefOrGetter<SessionScope>) {
  const vynel = useVynel();
  const resolvedScope = computed(() => toValue(scope));
  return useQuery({
    queryKey: computed(() =>
      sessionKeys.list(sessionScopeKey(resolvedScope.value)),
    ),
    queryFn: () => vynel.chat.listSessions(resolvedScope.value),
  });
}
