import { type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { hubKeys } from "./hub-keys.js";

/** The hub account's signed-in devices — only asked for while signed in. */
export function useHubDevices(enabled: MaybeRefOrGetter<boolean>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: hubKeys.devices(),
    queryFn: async () => (await vynel.hub.listDevices()).devices,
    enabled,
  });
}
