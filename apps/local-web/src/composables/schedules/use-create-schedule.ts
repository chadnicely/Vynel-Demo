import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";

type CreateScheduleInput = Parameters<VynelClient["schedulesUser"]["create"]>[0];

/** Create a schedule at either scope (one-time via fireAt, recurring via cron). */
export function useCreateSchedule() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScheduleInput) => vynel.schedulesUser.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });
}
