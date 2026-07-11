import { useMutation } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";

/** Provision a hub account — the hub mails (or, in dev, logs) the
 *  set-password link; the portal only gets the new accountId back. */
export function useProvisionAccount() {
  return useMutation({
    mutationFn: (input: { email: string; displayName: string }) =>
      adminApiFetch<{ accountId: string }>("/admin/accounts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}
