import { computed, shallowRef, toValue, watch } from "vue";
import type { ComputedRef, MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { useActivityStore } from "../../stores/activity-store.js";
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

/** The session the scope's CONTINUOUS thread displays: the primary's current
 *  head — or, before the primary's first turn lands (the head is bridged at
 *  turn end), the primary turn the activity feed reports running in the
 *  scope. Without the fallback a fresh workspace's very first turn is
 *  invisible from every window but the one that sent it, until it ends. */
export function useContinuingSessionId(
  scope: MaybeRefOrGetter<SessionScope>,
  continuingQuery: ReturnType<typeof useContinuingConversation>,
): ComputedRef<string | null> {
  const activity = useActivityStore();
  const scopeKey = computed(() => sessionScopeKey(toValue(scope)));
  // STICKY: the feed drops the turn at turn-ended (and on a socket drop) a
  // beat before the continuing refetch lands the bridged head — without
  // memory the thread would flash its welcome hero and tear its watch down
  // in that gap. The last running id stands until the head arrives; a scope
  // change forgets it.
  const lastRunningId = shallowRef<string | null>(null);
  watch(scopeKey, () => {
    lastRunningId.value = null;
  });
  const runningId = computed(() => {
    const s = toValue(scope);
    return activity.runningPrimarySessionIdFor(
      s.kind === "global"
        ? { kind: "global" }
        : { kind: "workspace", workspaceId: s.workspaceId },
    );
  });
  watch(
    runningId,
    (id) => {
      if (id !== null) lastRunningId.value = id;
    },
    { immediate: true },
  );
  return computed(
    () =>
      continuingQuery.data.value?.currentSdkSessionId ??
      runningId.value ??
      lastRunningId.value,
  );
}
