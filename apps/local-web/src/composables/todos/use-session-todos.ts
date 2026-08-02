import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { todoKeys } from "./todo-keys.js";

/** One session's working steps, in list order. Disabled (never fetched) while
 *  the host has no session — a fresh thread has no dock to fill. */
export function useSessionTodos(sessionId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const resolvedSessionId = computed(() => toValue(sessionId));
  return useQuery({
    queryKey: computed(() => todoKeys.forSession(resolvedSessionId.value ?? "none")),
    queryFn: () => vynel.todos.list({ sessionId: resolvedSessionId.value! }),
    enabled: computed(() => resolvedSessionId.value !== null),
  });
}
