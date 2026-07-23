import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Approve or ignore a discovered group room. */
export function useSetGroupStatus() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      channelId: string;
      groupId: string;
      status: "approved" | "ignored";
    }) =>
      input.status === "approved"
        ? vynel.channelsUser.approveGroup(input.channelId, input.groupId)
        : vynel.channelsUser.ignoreGroup(input.channelId, input.groupId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["channels", "groups"] }),
  });
}
