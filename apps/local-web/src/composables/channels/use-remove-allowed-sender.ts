import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Remove an allowed sender from a channel's allowlist. */
export function useRemoveAllowedSender() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; senderLinkId: string }) =>
      vynel.channelsUser.removeAllowedSender(
        input.channelId,
        input.senderLinkId,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["channels", "allowed-senders"],
      }),
  });
}
