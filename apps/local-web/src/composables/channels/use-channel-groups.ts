import { toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** The group rooms the bot has been seen in for one channel (pending +
 *  approved + ignored). `channelId` null disables the query. */
export function useChannelGroups(channelId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: ["channels", "groups", channelId],
    queryFn: () => {
      const id = toValue(channelId);
      if (id === null) throw new Error("useChannelGroups: no channelId");
      return vynel.channelsUser.listGroups(id);
    },
    enabled: () => toValue(channelId) !== null,
  });
}
