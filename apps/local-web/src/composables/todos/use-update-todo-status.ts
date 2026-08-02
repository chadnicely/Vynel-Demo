import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { SessionTodoStatus } from "@vynel/contracts/tasks/session-todo-http";
import { invalidateTodoViews } from "./todo-keys.js";

/** The user ticking a step off in the dock (or putting it back). */
export function useUpdateTodoStatus() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { todoId: string; status: SessionTodoStatus }) =>
      vynel.todos.updateStatus(input.todoId, { status: input.status }),
    onSuccess: () => invalidateTodoViews(queryClient),
  });
}
