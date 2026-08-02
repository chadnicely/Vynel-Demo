import type { QueryClient } from "@tanstack/vue-query";
import { invalidateTaskViews } from "../tasks/task-keys.js";
import { invalidateTodoViews } from "../todos/todo-keys.js";

// The assistant's OWN work-tracking writes (tasks + the working-steps dock)
// happen mid-turn, through MCP tools — nothing the user clicked, so nothing
// invalidated their queries. Until this existed, a task Claude created or a
// step it ticked only appeared after some unrelated refetch: the panel and the
// dock sat stale for the whole turn.
const WORK_MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
  "mcp__vynel__set_todos",
  "mcp__vynel__create_task",
  "mcp__vynel__update_task",
  "mcp__vynel__complete_task",
]);

/** Did this completed tool call change the task list or the step dock? */
export function isWorkMutatingToolName(toolName: string): boolean {
  return WORK_MUTATING_TOOL_NAMES.has(toolName);
}

/** Refresh both surfaces the assistant writes to. Called on every turn settle
 *  and immediately when one of the tools above completes mid-turn. */
export function invalidateWorkViews(queryClient: QueryClient) {
  return Promise.all([
    invalidateTaskViews(queryClient),
    invalidateTodoViews(queryClient),
  ]);
}
