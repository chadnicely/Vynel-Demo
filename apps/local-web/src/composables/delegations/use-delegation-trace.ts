import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

// The condensed trace of one delegation, keyed by its partialSessionId (the
// correlation key on a "Watch X" chip — NOT a session id). Live-settles: polls
// while the routed task is still pending/claimed so the workspace's task →
// reply → report fill in, and stops once the delegation is terminal.
const TRACE_POLL_MS = 2_500;
// While the SSE observe stream is attached the poll drops to a slow KEEP-ALIVE,
// not off: settled rows keep advancing under the stream (the mid-turn-attach
// freeze guard — the fetched trace may hold a partial assistant row the overlay
// can't extend), and — because TanStack re-evaluates refetchInterval only on
// query updates — the keep-alive tick is also what notices a dropped stream and
// restores fast polling.
// Exported: the activity monitor's session-transcript query uses the SAME
// cadence, so a mid-turn attach unfreezes identically for both source kinds.
export const TRACE_KEEP_ALIVE_MS = TRACE_POLL_MS * 4;

export function useDelegationTrace(
  partialSessionId: MaybeRefOrGetter<string | null>,
  // True while the SSE observe stream is attached — the poll slows to the
  // keep-alive cadence (never fully off; see TRACE_KEEP_ALIVE_MS).
  streamAttached: MaybeRefOrGetter<boolean> = false,
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
      const isLive = status === "pending" || status === "claimed";
      if (!isLive) return false;
      return toValue(streamAttached) ? TRACE_KEEP_ALIVE_MS : TRACE_POLL_MS;
    },
  });
}
