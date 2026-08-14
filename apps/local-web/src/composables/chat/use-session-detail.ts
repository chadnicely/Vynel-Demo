import { computed, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { sessionKeys, sessionScopeKey } from "./session-keys.js";
import type { SessionScope } from "./session-scope.js";

// One session's full detail (session + messages + tool calls). A workspace
// session reads through `chat.getSession`; a global-root session (any
// root-owned session opened in the viewer) reads through `root.getSession` —
// both return the same detail envelope.
//
// A CONTINUING thread (`isContinuous`) reads the chain-spanning transcript
// instead (`chat.getContinuingTranscript` / `root.getTranscript`): the primary
// swaps to a fresh SDK segment under context pressure, and the single-segment
// read then rendered an EMPTY conversation while every pre-swap row sat one
// chain-link away (the tester-DB incident, 2026-08-14). The transcript's
// `session` is the current segment (nullable pre-first-turn), so the returned
// envelope carries `session: ... | null` — callers read it with `?.`.
// `sessionId` stays the enable-gate AND rides the query key: a swap repoints
// the primary, the head id changes, and the thread refetches onto the fresh
// chain automatically.
export function useSessionDetail(
  scope: MaybeRefOrGetter<SessionScope>,
  sessionId: MaybeRefOrGetter<string | null>,
  // Poll interval (ms) or `false` to poll off. Used to keep the global thread
  // live while a background delegation is running so its pushed report surfaces
  // promptly (there is no server push).
  refetchInterval?: MaybeRefOrGetter<number | false>,
  isContinuous?: MaybeRefOrGetter<boolean>,
) {
  const vynel = useVynel();
  const resolvedScope = computed(() => toValue(scope));
  const id = computed(() => toValue(sessionId));
  const continuous = computed(() => toValue(isContinuous ?? false));
  return useQuery({
    queryKey: computed(() =>
      sessionKeys.detail(
        sessionScopeKey(resolvedScope.value),
        // A cache entry per read shape — the chain transcript and the
        // single-segment detail of the same head id must never share one.
        continuous.value ? `continuing:${id.value ?? "none"}` : (id.value ?? "none"),
      ),
    ),
    queryFn: async () => {
      const currentId = id.value;
      if (currentId === null)
        throw new Error("Session detail queried without a session id.");
      const s = resolvedScope.value;
      if (continuous.value) {
        return s.kind === "global"
          ? vynel.root.getTranscript()
          : vynel.chat.getContinuingTranscript(s.workspaceId);
      }
      return s.kind === "global"
        ? vynel.root.getSession(currentId)
        : vynel.chat.getSession(s.workspaceId, currentId);
    },
    enabled: computed(() => id.value !== null),
    refetchInterval: () => toValue(refetchInterval ?? false),
  });
}
