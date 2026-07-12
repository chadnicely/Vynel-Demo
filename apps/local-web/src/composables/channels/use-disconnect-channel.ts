import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Disconnect a channel the user owns (hard-delete + cascade server-side —
 *  the bot token must be re-entered to reconnect). */
export function useDisconnectChannel() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string }) =>
      vynel.channelsUser.disconnect(input.channelId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["channels"] }),
  });
}
