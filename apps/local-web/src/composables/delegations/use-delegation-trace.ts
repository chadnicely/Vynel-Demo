import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

// The condensed trace of one delegation, keyed by its partialSessionId (the
// correlation key on a "Watch X" chip — NOT a session id). Live-settles: polls
// while the routed task is still pending/claimed so the workspace's task →
// reply → report fill in, and stops once the delegation is terminal.
const TRACE_POLL_MS = 2_500;

export function useDelegationTrace(
  partialSessionId: MaybeRefOrGetter<string | null>,
) {
  const vynel = useVynel();
  const id = computed(() => toValue(partialSessionId));
  return useQuery({
    queryKey: computed(() => ["delegations", "trace", id.value ?? "none"]),
    queryFn: () => {
      const currentId = id.value;
      if (currentId === null)
        throw new Error("Delegation trace queried without a key.");
      return vynel.root.getTrace(currentId);
    },
    enabled: computed(() => id.value !== null),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "claimed"
        ? TRACE_POLL_MS
        : false;
    },
  });
}
