import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { rulesKeys } from "./rules-keys.js";
import type { VynelClient } from "@vynel/sdk";

type WriteRuleBody = Parameters<VynelClient["rules"]["write"]>[1];

/** Create or replace one of the user's OWN rule files at either scope —
 *  the file is the record, so a save is a whole-file write. */
export function useWriteRule() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ruleId: string; body: WriteRuleBody }) =>
      vynel.rules.write(input.ruleId, input.body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rulesKeys.all }),
  });
}
