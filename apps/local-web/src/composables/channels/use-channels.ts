import { type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

export function useChannels(enabled: MaybeRefOrGetter<boolean>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: ["channels", "list"],
    queryFn: () => vynel.channelsUser.list(),
    enabled,
  });
}
