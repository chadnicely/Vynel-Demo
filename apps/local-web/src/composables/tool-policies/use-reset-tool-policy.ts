import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { toolPolicyKeys } from "./tool-policy-keys.js";

/** Reset one tool to its declared defaults — DELETE drops the override row
 *  (deleting IS the reset; the declared world stays the source of truth). */
export function useResetToolPolicy() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (toolName: string) => vynel.toolPolicies.reset(toolName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: toolPolicyKeys.all });
    },
  });
}
