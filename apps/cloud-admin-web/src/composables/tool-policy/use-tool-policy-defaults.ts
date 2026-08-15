import { useQuery } from "@tanstack/vue-query";
import type { ToolPolicyDefault } from "@vynel/contracts/tool-policy/defaults";
import { adminApiFetch } from "../../lib/admin-api.js";
import { toolPolicyKeys } from "./tool-policy-keys.js";

/** Every GLOBAL per-tool override the hub stores. Tools without a row here
 *  run on their declared catalog defaults — the view overlays this list on
 *  the static snapshot. */
export function useToolPolicyDefaults() {
  return useQuery({
    queryKey: toolPolicyKeys.list(),
    queryFn: async () =>
      (
        await adminApiFetch<{ defaults: ToolPolicyDefault[] }>(
          "/admin/tool-policy",
        )
      ).defaults,
  });
}
