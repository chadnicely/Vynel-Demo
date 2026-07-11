import { useMutation } from "@tanstack/vue-query";
import type { HubAccountRole } from "@vynel/contracts/hub/admin";
import { adminApiFetch } from "../../lib/admin-api.js";

/** Grant (or revoke, by setting `member`) the admin role on an account. */
export function useGrantAccountRole() {
  return useMutation({
    mutationFn: (input: { accountId: string; role: HubAccountRole }) =>
      adminApiFetch<{ accountId: string; role: HubAccountRole }>(
        `/admin/accounts/${input.accountId}/role`,
        { method: "POST", body: JSON.stringify({ role: input.role }) },
      ),
  });
}
