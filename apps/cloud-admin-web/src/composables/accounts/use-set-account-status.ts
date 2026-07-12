import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { HubAccountStatus } from "@vynel/contracts/hub/admin";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminAccountsKeys } from "./accounts-keys.js";

/** Enable/disable an account. Disabling also revokes every device session on
 *  the hub side — the account's tokens die on their next request. */
export function useSetAccountStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; status: HubAccountStatus }) =>
      adminApiFetch<{ accountId: string; status: HubAccountStatus }>(
        `/admin/accounts/${input.accountId}/status`,
        { method: "POST", body: JSON.stringify({ status: input.status }) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminAccountsKeys.all }),
  });
}
