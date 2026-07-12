import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Flip an agent on or off for the session resolver. A user-scope agent
 *  shows on every surface, so the whole `["agents"]` prefix refreshes. */
export function useSetAgentEnabled() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { agentId: string; enabled: boolean }) =>
      vynel.agents.setEnabled(input.agentId, { enabled: input.enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
