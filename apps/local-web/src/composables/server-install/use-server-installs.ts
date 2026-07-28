import { type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { ServerInstallResponse } from "@vynel/contracts/server-install/server-install-http";
import { useVynel } from "../use-vynel.js";
import { serverInstallKeys } from "./server-install-keys.js";

const PROVISIONING_POLL_MS = 1_500;
const SETTLED_POLL_MS = 30_000;

/** The user's remote engine installs. Provisioning runs for minutes in the
 *  background and the row carries its live `step`, so the poll tightens while
 *  anything is still provisioning and relaxes once everything has settled. */
export function useServerInstalls(enabled: MaybeRefOrGetter<boolean>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: serverInstallKeys.list,
    queryFn: async () => (await vynel.serverInstall.list()) as ServerInstallResponse[],
    enabled,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((install) => install.status === "provisioning")
        ? PROVISIONING_POLL_MS
        : SETTLED_POLL_MS,
  });
}
