import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Rename a channel the user owns (the one editable field post-connect). */
export function useRenameChannel() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; displayName: string }) =>
      vynel.channelsUser.rename(input.channelId, {
        displayName: input.displayName,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["channels"] }),
  });
}
