import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Pause (disable) or resume (enable) a channel's polling. */
export function useSetChannelEnabled() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; isEnabled: boolean }) =>
      input.isEnabled
        ? vynel.channelsUser.enable(input.channelId)
        : vynel.channelsUser.disable(input.channelId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["channels"] }),
  });
}
