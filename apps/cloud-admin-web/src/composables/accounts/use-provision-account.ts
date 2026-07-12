import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminAccountsKeys } from "./accounts-keys.js";

/** Provision a hub account — the hub mails (or, in dev, logs) the
 *  set-password link; the portal only gets the new accountId back. */
export function useProvisionAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; displayName: string }) =>
      adminApiFetch<{ accountId: string }>("/admin/accounts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminAccountsKeys.all }),
  });
}
