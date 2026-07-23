import { toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** The allowlist for one channel — who may message the bot. `channelId`
 *  null disables the query (no dialog open). */
export function useAllowedSenders(channelId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: ["channels", "allowed-senders", channelId],
    queryFn: () => {
      const id = toValue(channelId);
      if (id === null) throw new Error("useAllowedSenders: no channelId");
      return vynel.channelsUser.listAllowedSenders(id);
    },
    enabled: () => toValue(channelId) !== null,
  });
}
