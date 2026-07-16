import { type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { taskKeys } from "./task-keys.js";

export function useTasks(enabled: MaybeRefOrGetter<boolean>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: taskKeys.list(),
    queryFn: () => vynel.tasksUser.list(),
    enabled,
  });
}
