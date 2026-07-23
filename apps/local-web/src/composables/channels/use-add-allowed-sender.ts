import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Add an allowed sender (external user id + optional handle/name) to a
 *  channel's allowlist. */
export function useAddAllowedSender() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      channelId: string;
      externalSenderId: string;
      externalSenderHandle?: string;
      externalSenderDisplayName?: string;
    }) =>
      vynel.channelsUser.addAllowedSender(input.channelId, {
        externalSenderId: input.externalSenderId,
        ...(input.externalSenderHandle !== undefined
          ? { externalSenderHandle: input.externalSenderHandle }
          : {}),
        ...(input.externalSenderDisplayName !== undefined
          ? { externalSenderDisplayName: input.externalSenderDisplayName }
          : {}),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["channels", "allowed-senders"],
      }),
  });
}
