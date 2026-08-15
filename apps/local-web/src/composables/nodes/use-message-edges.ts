import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Asked for a little more than the arcs live for, so a screen that just opened
 *  still catches one already in flight. */
const WINDOW_SECONDS = 120;

/** Often enough that an arc appears while the message still feels current —
 *  the line lives a minute, so a sub-second cadence would buy nothing. */
const POLL_MS = 8_000;

export const messageEdgeKeys = {
  recent: () => ["activity", "message-edges"] as const,
};

// Who spoke to whom, just now. Polled rather than pushed: the activity feed's
// vocabulary is turn liveness, and a short-lived line does not justify a new
// event kind on that contract.
export function useMessageEdges(enabled: () => boolean) {
  const vynel = useVynel();
  return useQuery({
    queryKey: messageEdgeKeys.recent(),
    queryFn: () => vynel.activity.listRecentMessages({ withinSeconds: WINDOW_SECONDS }),
    enabled,
    refetchInterval: () => (enabled() ? POLL_MS : false),
  });
}
