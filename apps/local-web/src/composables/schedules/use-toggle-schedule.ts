import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Pause/resume a schedule — the user-level PATCH covers both scopes (rows are
 *  owner-scoped, workspace or global). */
export function useToggleSchedule() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { scheduleId: string; isEnabled: boolean }) =>
      vynel.schedulesUser.update(input.scheduleId, {
        isEnabled: input.isEnabled,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });
}
