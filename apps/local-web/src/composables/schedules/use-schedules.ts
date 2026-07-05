import { type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

export function useSchedules(enabled: MaybeRefOrGetter<boolean>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: ["schedules", "list"],
    queryFn: () => vynel.schedulesUser.list(),
    enabled,
  });
}
