import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";

type ConnectChannelInput = Parameters<VynelClient["channelsUser"]["connect"]>[0];

/** Connect a channel at either scope (the user-level route's discriminated
 *  union carries global vs workspace). */
export function useConnectChannel() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectChannelInput) => vynel.channelsUser.connect(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["channels"] }),
  });
}
