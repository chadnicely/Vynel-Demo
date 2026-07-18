import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { sessionKeys } from "../chat/session-keys.js";

// The user's Stop on a routed task: a pending job fails before claim; a
// running one is flagged + interrupted server-side (the tick records the stop
// at terminal time). Settle both liveness reads so the banner chip clears and
// the thread reflects the stop promptly.
export function useStopDelegation() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (partialSessionId: string) =>
      vynel.root.stopDelegation(partialSessionId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["delegations"] });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}
