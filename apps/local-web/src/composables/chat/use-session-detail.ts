import { computed, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { sessionKeys, sessionScopeKey } from "./session-keys.js";
import type { SessionScope } from "./session-scope.js";

/** How the detail read resolves its messages:
 *  - `segment`: ONE session's own rows (`chat.getSession` / `root.getSession`)
 *    — an explicitly opened part stays put on its segment.
 *  - `continuing`: the scope's continuing primary, messages across its whole
 *    swap chain (`chat.getContinuingTranscript` / `root.getTranscript`).
 *  - `chain`: the chain by its head id, messages across the whole chain
 *    (`root.getSessionTranscript`) — the Sessions panel's followed chains.
 *  The chain-spanning modes exist because a context-pressure swap repoints a
 *  conversation at a fresh, empty segment — the single-segment read then
 *  rendered an EMPTY thread while every pre-swap row sat one chain-link away
 *  (the tester-DB incident, 2026-08-14). */
export type SessionDetailMode = "segment" | "continuing" | "chain";

// One session's full detail (session + messages + tool calls) — the envelope
// is the same in every mode; `continuing` carries `session: null` until the
// scope's first continue-mode turn, so callers read `session` with `?.`.
// `sessionId` stays the enable-gate AND rides the query key in every mode: a
// swap repoints the chain, the head id changes, and the thread refetches onto
// the fresh chain automatically.
export function useSessionDetail(
  scope: MaybeRefOrGetter<SessionScope>,
  sessionId: MaybeRefOrGetter<string | null>,
  // Poll interval (ms) or `false` to poll off. Used to keep the global thread
  // live while a background delegation is running so its pushed report surfaces
  // promptly (there is no server push).
  refetchInterval?: MaybeRefOrGetter<number | false>,
  mode?: MaybeRefOrGetter<SessionDetailMode>,
) {
  const vynel = useVynel();
  const resolvedScope = computed(() => toValue(scope));
  const id = computed(() => toValue(sessionId));
  const resolvedMode = computed<SessionDetailMode>(() => toValue(mode ?? "segment"));
  return useQuery({
    queryKey: computed(() =>
      sessionKeys.detail(
        sessionScopeKey(resolvedScope.value),
        // A cache entry per read shape — a chain transcript and the
        // single-segment detail of the same head id must never share one.
        resolvedMode.value === "segment"
          ? (id.value ?? "none")
          : `${resolvedMode.value}:${id.value ?? "none"}`,
      ),
    ),
    queryFn: async () => {
      const currentId = id.value;
      if (currentId === null)
        throw new Error("Session detail queried without a session id.");
      const s = resolvedScope.value;
      if (resolvedMode.value === "continuing") {
        return s.kind === "global"
          ? vynel.root.getTranscript()
          : vynel.chat.getContinuingTranscript(s.workspaceId);
      }
      if (resolvedMode.value === "chain") {
        // Owner-gated any-session read — scope-independent by design.
        return vynel.root.getSessionTranscript(currentId);
      }
      return s.kind === "global"
        ? vynel.root.getSession(currentId)
        : vynel.chat.getSession(s.workspaceId, currentId);
    },
    enabled: computed(() => id.value !== null),
    refetchInterval: () => toValue(refetchInterval ?? false),
  });
}
