import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

// Polls the brain's in-flight delegations while the global chat is mounted. A
// routed task runs in the BACKGROUND and pushes its report into the global
// thread on completion — the UI has no server push, so this poll is how the
// user sees a delegation is working and (via the global thread's own poll while
// this is non-empty) how the report surfaces promptly once it lands.
const IN_FLIGHT_POLL_MS = 4_000;

export function useInFlightDelegations() {
  const vynel = useVynel();
  return useQuery({
    queryKey: ["delegations", "in-flight"],
    queryFn: () => vynel.root.listDelegations(),
    select: (response) => response.delegations,
    refetchInterval: IN_FLIGHT_POLL_MS,
  });
}
