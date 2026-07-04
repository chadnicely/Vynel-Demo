import { computed, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { sessionKeys } from "./session-keys.js";

export function useSessionDetail(sessionId: MaybeRefOrGetter<string | null>) {
  const vynel = useVynel();
  const id = computed(() => toValue(sessionId));
  return useQuery({
    queryKey: computed(() => sessionKeys.detail(id.value ?? "none")),
    queryFn: () => {
      const sessionId = id.value;
      if (sessionId === null)
        throw new Error("Session detail queried without a session id.");
      return vynel.chat.getSessionDetail(sessionId);
    },
    enabled: computed(() => id.value !== null),
  });
}
