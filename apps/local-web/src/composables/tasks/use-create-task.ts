import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidateTaskViews } from "./task-keys.js";

type CreateTaskInput = Parameters<VynelClient["tasksUser"]["create"]>[0];

/** Create a task at either scope (global, or pinned to one workspace). */
export function useCreateTask() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => vynel.tasksUser.create(input),
    onSuccess: () => invalidateTaskViews(queryClient),
  });
}
