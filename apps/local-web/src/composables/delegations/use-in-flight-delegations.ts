import { toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

// Polls the brain's in-flight delegations while a chat view is mounted (or
// the Background roster shows). A routed task runs in the BACKGROUND and
// pushes its report into the thread on completion — the UI has no server
// push, so this poll is how the user sees a delegation is working and (via
// the thread's own poll while this is non-empty) how the report surfaces
// promptly once it lands.
const IN_FLIGHT_POLL_MS = 4_000;

export function useInFlightDelegations(
  // Gate for always-mounted hosts (the monitor panel lives in the shell) —
  // an ungated observer there would keep the poll running app-wide forever.
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: ["delegations", "in-flight"],
    queryFn: () => vynel.root.listDelegations(),
    select: (response) => response.delegations,
    enabled,
    refetchInterval: () => (toValue(enabled) ? IN_FLIGHT_POLL_MS : false),
  });
}
