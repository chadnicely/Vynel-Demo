import { type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { planKeys } from "./plan-keys.js";

export function usePlans(enabled: MaybeRefOrGetter<boolean>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: planKeys.list(),
    queryFn: () => vynel.plansUser.list(),
    enabled,
  });
}
