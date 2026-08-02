import type { QueryClient } from "@tanstack/vue-query";

// The working-steps dock reads ONE session at a time, so the session id is
// part of the key — switching threads is a different query, never a refetch of
// the same one.
export const todoKeys = {
  all: ["todos"] as const,
  forSession: (sessionId: string) =>
    [...todoKeys.all, "session", sessionId] as const,
};

/** Every dock on screen (and every cached thread) refreshes together — a step
 *  moved anywhere is the same list everywhere. */
export function invalidateTodoViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: todoKeys.all });
}
