import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidatePlanViews } from "./plan-keys.js";

type CreatePlanInput = Parameters<VynelClient["plansUser"]["create"]>[0];

/** Create a plan at either scope (global, or pinned to one workspace). */
export function useCreatePlan() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlanInput) => vynel.plansUser.create(input),
    onSuccess: () => invalidatePlanViews(queryClient),
  });
}
