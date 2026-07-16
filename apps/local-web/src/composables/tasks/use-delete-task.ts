import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateTaskViews } from "./task-keys.js";

export function useDeleteTask() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskId: string }) =>
      vynel.tasksUser.delete(input.taskId),
    onSuccess: () => invalidateTaskViews(queryClient),
  });
}
