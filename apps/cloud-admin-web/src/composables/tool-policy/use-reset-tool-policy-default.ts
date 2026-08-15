import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";
import { toolPolicyKeys } from "./tool-policy-keys.js";

/** DELETE an override so the tool falls back to its declared default. */
export function useResetToolPolicyDefault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (toolName: string) =>
      adminApiFetch<{ default: null }>(`/admin/tool-policy/${toolName}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: toolPolicyKeys.all }),
  });
}
