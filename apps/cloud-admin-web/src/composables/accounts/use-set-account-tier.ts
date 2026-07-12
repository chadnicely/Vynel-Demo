import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { HubTier } from "@vynel/contracts/hub/entitlements";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminAccountsKeys } from "./accounts-keys.js";

/** Override an account's tier. The portal sets no expiry (null = the tier
 *  never lapses) — timed grants stay the platform webhook's job. */
export function useSetAccountTier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; tier: HubTier }) =>
      adminApiFetch<{ accountId: string; tier: HubTier }>(
        `/admin/accounts/${input.accountId}/tier`,
        {
          method: "POST",
          body: JSON.stringify({ tier: input.tier, tierExpiresAt: null }),
        },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminAccountsKeys.all }),
  });
}
