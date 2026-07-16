import { useQuery } from "@tanstack/vue-query";
import type { AskRequestResponse } from "@vynel/contracts/asks/ask-http";
import { useVynel } from "../use-vynel.js";
import { askKeys } from "./ask-keys.js";

// Always-on poll (the pending-approvals precedent): a pending ask surfaces as
// a notification no matter which view is open; swaps to push when the
// realtime stream lands.
export function usePendingAsks() {
  const vynel = useVynel();
  return useQuery({
    queryKey: askKeys.pending(),
    // Route carries no response schema — cast via contracts (house pattern).
    queryFn: async () =>
      (await vynel.asks.listPending()) as AskRequestResponse[],
    refetchInterval: 5_000,
    // The local API may be down while the UI runs demo-only; the poll interval
    // already re-attempts, so per-fetch retries would just stack noise.
    retry: false,
  });
}
