import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateTodoViews } from "./todo-keys.js";

/** Drop a step off the dock. Hard delete — the session may put it back on its
 *  next list; that is the point of a step list. */
export function useDeleteTodo() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { todoId: string }) => vynel.todos.delete(input.todoId),
    onSuccess: () => invalidateTodoViews(queryClient),
  });
}
