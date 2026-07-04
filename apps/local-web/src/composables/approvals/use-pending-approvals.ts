import { useQuery } from "@tanstack/vue-query";
import type { ApprovalRequestResponse } from "@vynel/contracts/approvals/approval-http";
import { useVynel } from "../use-vynel.js";
import { approvalKeys } from "./approval-keys.js";

// The one always-on REAL query (the approvals API is live today). Polled so a
// pending approval surfaces as a notification no matter which view is open;
// swaps to push when the realtime stream lands.
export function usePendingApprovals() {
  const vynel = useVynel();
  return useQuery({
    queryKey: approvalKeys.pending(),
    // Route carries no response schema — cast via contracts (house pattern).
    queryFn: async () =>
      (await vynel.approvals.listPending()) as ApprovalRequestResponse[],
    refetchInterval: 5_000,
    // The local API may be down while the UI runs demo-only; the poll interval
    // already re-attempts, so per-fetch retries would just stack noise.
    retry: false,
  });
}
