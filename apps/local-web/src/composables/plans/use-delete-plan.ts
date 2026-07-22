import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidatePlanViews } from "./plan-keys.js";

export function useDeletePlan() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { planId: string }) =>
      vynel.plansUser.delete(input.planId),
    onSuccess: () => invalidatePlanViews(queryClient),
  });
}
