import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { workspaceAppKeys } from "./workspace-app-keys.js";

/** The app's recent output lines — fetched only while a log view is open, and
 *  re-polled so the tail follows the running process. */
export function useAppLogs(
  workspaceId: MaybeRefOrGetter<string>,
  appId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() =>
      workspaceAppKeys.logs(toValue(workspaceId), toValue(appId)),
    ),
    queryFn: () =>
      vynel.workspaceApps.logs(toValue(workspaceId), toValue(appId), {
        tail: 200,
      }),
    enabled,
    refetchInterval: 2_000,
  });
}
