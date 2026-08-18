import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { taskKeys } from "./task-keys.js";

/** One task's execution steps, in list order — the panel expander's and the
 *  task dialog's read. Disabled (never fetched) while no task is expanded. */
export function useTaskSteps(taskId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const resolvedTaskId = computed(() => toValue(taskId));
  return useQuery({
    queryKey: computed(() => taskKeys.steps(resolvedTaskId.value ?? "none")),
    queryFn: () => vynel.tasksUser.listSteps(resolvedTaskId.value!),
    enabled: computed(() => resolvedTaskId.value !== null),
  });
}
