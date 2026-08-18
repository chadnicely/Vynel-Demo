import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { planKeys } from "./plan-keys.js";

/** The EXECUTION PLAN of one task — the plan whose loose `taskId` points at
 *  it (task-execution arc; at most one in practice, first row wins).
 *  Disabled while no task is being viewed. */
export function usePlanForTask(taskId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const resolvedTaskId = computed(() => toValue(taskId));
  const query = useQuery({
    queryKey: computed(() => planKeys.forTask(resolvedTaskId.value ?? "none")),
    queryFn: () => vynel.plansUser.list({ taskId: resolvedTaskId.value! }),
    enabled: computed(() => resolvedTaskId.value !== null),
  });
  const plan = computed(() => query.data.value?.[0] ?? null);
  return { query, plan };
}
