import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { TaskStepStatus } from "@vynel/contracts/tasks/task-step-http";
import { invalidateTaskViews } from "./task-keys.js";

/** Move one task step (the user ticking a box on the panel or in the task
 *  dialog). Invalidates the task views — the list rows' n/m rollup and any
 *  open step list both live under the tasks key namespace. */
export function useUpdateStepStatus() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ stepId, status }: { stepId: string; status: TaskStepStatus }) =>
      vynel.tasksUser.updateStepStatus(stepId, { status }),
    onSuccess: () => invalidateTaskViews(queryClient),
  });
}
