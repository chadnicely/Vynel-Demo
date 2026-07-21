import { computed, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { sessionKeys, sessionScopeKey } from "./session-keys.js";
import type { SessionScope } from "./session-scope.js";

// One session's full detail (session + messages + tool calls). A workspace
// session reads through `chat.getSession`; a global-root session (the brain's
// continuing conversation, or any root-owned session opened in the viewer)
// reads through `root.getSession` — both return the same detail envelope.
export function useSessionDetail(
  scope: MaybeRefOrGetter<SessionScope>,
  sessionId: MaybeRefOrGetter<string | null>,
  // Poll interval (ms) or `false` to poll off. Used to keep the global thread
  // live while a background delegation is running so its pushed report surfaces
  // promptly (there is no server push).
  refetchInterval?: MaybeRefOrGetter<number | false>,
) {
  const vynel = useVynel();
  const resolvedScope = computed(() => toValue(scope));
  const id = computed(() => toValue(sessionId));
  return useQuery({
    queryKey: computed(() =>
      sessionKeys.detail(sessionScopeKey(resolvedScope.value), id.value ?? "none"),
    ),
    queryFn: () => {
      const currentId = id.value;
      if (currentId === null)
        throw new Error("Session detail queried without a session id.");
      const s = resolvedScope.value;
      return s.kind === "global"
        ? vynel.root.getSession(currentId)
        : vynel.chat.getSession(s.workspaceId, currentId);
    },
    enabled: computed(() => id.value !== null),
    refetchInterval: () => toValue(refetchInterval ?? false),
  });
}
