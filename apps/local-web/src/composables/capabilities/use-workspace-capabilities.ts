import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { capabilityKeys } from "./capability-keys.js";

/** One capability with its resolved enabled state, exactly as the list route
 *  returns it — typed off the generated SDK so the wire stays the one truth. */
export type WorkspaceCapabilityStatus = Awaited<
  ReturnType<VynelClient["capabilities"]["list"]>
>["capabilities"][number];

/** The capability ids the toggle route accepts — derived from the generated
 *  SDK's path enum rather than restated here. */
export type WorkspaceCapabilityId = Parameters<
  VynelClient["capabilities"]["setEnabled"]
>[1];

/** The workspace's capability roster (name + description + isEnabled).
 *  Workspace-scoped by design — the global surface has no toggle rows, so
 *  callers only mount this inside a workspace. */
export function useWorkspaceCapabilities(
  workspaceId: MaybeRefOrGetter<string>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => capabilityKeys.list(toValue(workspaceId))),
    queryFn: async () => {
      const response = await vynel.capabilities.list(toValue(workspaceId));
      return response.capabilities;
    },
  });
}
