import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidatePlanViews } from "./plan-keys.js";

type UpdatePlanPatch = Parameters<VynelClient["plansUser"]["update"]>[1];

/** Patch a plan — status moves (open → in-progress → done), date moves, edits. */
export function useUpdatePlan() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, ...patch }: { planId: string } & UpdatePlanPatch) =>
      vynel.plansUser.update(planId, patch),
    onSuccess: () => invalidatePlanViews(queryClient),
  });
}
