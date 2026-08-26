import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { rulesKeys } from "./rules-keys.js";
import type { VynelClient } from "@vynel/sdk";

type DeleteRuleScope = Parameters<VynelClient["rules"]["delete"]>[1];

/** Delete one rule file at a scope — the user's own or a marketplace
 *  install alike; the file is gone from disk. */
export function useDeleteRule() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ruleId: string; scope: DeleteRuleScope }) =>
      vynel.rules.delete(input.ruleId, input.scope),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rulesKeys.all }),
  });
}
