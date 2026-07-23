import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Flip a group's member policy: everyone in the room, or allowed senders only. */
export function useSetGroupPolicy() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      channelId: string;
      groupId: string;
      memberPolicy: "everyone" | "allowlist";
    }) =>
      vynel.channelsUser.setGroupPolicy(input.channelId, input.groupId, {
        memberPolicy: input.memberPolicy,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["channels", "groups"] }),
  });
}
