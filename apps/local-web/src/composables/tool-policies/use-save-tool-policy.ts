import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { SaveToolPolicyBody } from "./tool-policy-contract.js";
import { toolPolicyKeys } from "./tool-policy-keys.js";

export interface SaveToolPolicyInput {
  toolName: string;
  body: SaveToolPolicyBody;
}

/** Save one tool's override — FULL-REPLACE: the body speaks for every field,
 *  null meaning "inherit the declared default". The server re-resolves the
 *  merge, so the whole matrix refreshes rather than patching one row. */
export function useSaveToolPolicy() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveToolPolicyInput) =>
      vynel.toolPolicies.save(input.toolName, input.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: toolPolicyKeys.all });
    },
  });
}
