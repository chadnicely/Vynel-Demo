import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { AppEnvResponse } from "@vynel/contracts/apps/app-http";
import { useVynel } from "../use-vynel.js";
import { workspaceAppKeys } from "./workspace-app-keys.js";

/** The app's env file parsed into entries — fetched only while the env popup
 *  is open. No polling: the file changes when the user saves, and the
 *  mutation invalidates this key. Values are secrets — never log them. */
export function useAppEnv(
  workspaceId: MaybeRefOrGetter<string>,
  appId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() =>
      workspaceAppKeys.env(toValue(workspaceId), toValue(appId)),
    ),
    queryFn: async () =>
      (await vynel.workspaceApps.env(
        toValue(workspaceId),
        toValue(appId),
      )) as AppEnvResponse,
    enabled,
  });
}
