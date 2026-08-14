import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type {
  ToolPolicyDefault,
  ToolPolicyDefaultFields,
} from "@vynel/contracts/tool-policy/defaults";
import { adminApiFetch } from "../../lib/admin-api.js";
import { toolPolicyKeys } from "./tool-policy-keys.js";

/** PUT the FULL fields object (nulls = inherit). The hub normalizes an
 *  all-null body to a reset and answers `default: null`. */
export function useSaveToolPolicyDefault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      toolName: string;
      fields: ToolPolicyDefaultFields;
    }) =>
      adminApiFetch<{ default: ToolPolicyDefault | null }>(
        `/admin/tool-policy/${input.toolName}`,
        { method: "PUT", body: JSON.stringify(input.fields) },
      ),
    // One root key covers the list and the baked-map version — both change.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: toolPolicyKeys.all }),
  });
}
