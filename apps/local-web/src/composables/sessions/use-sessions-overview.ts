import { toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { sessionKeys } from "../chat/session-keys.js";

// The unified cross-scope session list (`GET /sessions/overview`) — one query
// shared by the Sessions view and the composer's context ring (vue-query
// dedupes the fetch). Keyed under sessionKeys.all so every turn-end
// invalidation refreshes it alongside the thread views.
export function useSessionsOverview(
  enabled: MaybeRefOrGetter<boolean>,
  refetchInterval?: MaybeRefOrGetter<number | false>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: sessionKeys.overview(),
    queryFn: () => vynel.sessions.overview(),
    enabled,
    refetchInterval: () => toValue(refetchInterval ?? false),
  });
}
