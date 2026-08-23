import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidatePhaseViews } from "./phase-keys.js";

type UpdatePhasePatch = Parameters<VynelClient["phases"]["update"]>[2];

/** Patch a phase — status moves (open → in-progress → done), edits, reorders. */
export function useUpdatePhase() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      phaseId,
      ...patch
    }: { workspaceId: string; phaseId: string } & UpdatePhasePatch) =>
      vynel.phases.update(workspaceId, phaseId, patch),
    onSuccess: () => invalidatePhaseViews(queryClient),
  });
}
