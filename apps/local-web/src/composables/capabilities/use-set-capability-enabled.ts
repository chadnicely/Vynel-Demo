import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { capabilityKeys } from "./capability-keys.js";
import type { WorkspaceCapabilityId } from "./use-workspace-capabilities.js";

export interface SetCapabilityEnabledInput {
  workspaceId: string;
  capabilityId: WorkspaceCapabilityId;
  isEnabled: boolean;
}

/** Flip one capability for one workspace. The route writes an override row
 *  either way (on OR off), so the refreshed list is the only honest state —
 *  invalidate that workspace's roster. */
export function useSetCapabilityEnabled() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetCapabilityEnabledInput) =>
      vynel.capabilities.setEnabled(input.workspaceId, input.capabilityId, {
        isEnabled: input.isEnabled,
      }),
    onSuccess: (_saved, input) => {
      queryClient.invalidateQueries({
        queryKey: capabilityKeys.list(input.workspaceId),
      });
    },
  });
}
