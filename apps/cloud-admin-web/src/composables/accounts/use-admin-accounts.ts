import { useQuery } from "@tanstack/vue-query";
import type { HubAdminAccount } from "@vynel/contracts/hub/admin";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminAccountsKeys } from "./accounts-keys.js";

/** Every hub account, newest first — the management table's source. The hub
 *  answers the allowlisted DTO only (no passwordHash, no platform ids). */
export function useAdminAccounts() {
  return useQuery({
    queryKey: adminAccountsKeys.list(),
    queryFn: async () =>
      (await adminApiFetch<{ accounts: HubAdminAccount[] }>("/admin/accounts"))
        .accounts,
  });
}
