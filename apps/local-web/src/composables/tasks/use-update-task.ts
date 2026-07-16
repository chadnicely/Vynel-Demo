import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidateTaskViews } from "./task-keys.js";

type UpdateTaskPatch = Parameters<VynelClient["tasksUser"]["update"]>[1];

/** Patch a task — status moves (open → in-progress → done) and title/detail edits. */
export function useUpdateTask() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...patch }: { taskId: string } & UpdateTaskPatch) =>
      vynel.tasksUser.update(taskId, patch),
    onSuccess: () => invalidateTaskViews(queryClient),
  });
}
