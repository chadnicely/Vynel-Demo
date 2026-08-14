import { useQuery } from "@tanstack/vue-query";
import type { ToolPolicyMapExport } from "@vynel/contracts/tool-policy/defaults";
import { adminApiFetch } from "../../lib/admin-api.js";
import { toolPolicyKeys } from "./tool-policy-keys.js";

/** The resolved map a desktop release build would bake — the page header
 *  shows its version hash so the operator knows what ships next. */
export function useToolPolicyMap() {
  return useQuery({
    queryKey: toolPolicyKeys.map(),
    queryFn: () => adminApiFetch<ToolPolicyMapExport>("/admin/tool-policy/map"),
  });
}
