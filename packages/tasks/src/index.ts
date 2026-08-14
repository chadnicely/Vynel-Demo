// Public surface of `@vynel/tasks` — the tasks leaf. Consumers reach the
// package only through this barrel; schema, repositories and the concern
// folders are internal (imported relatively).

export type { StructuralLogger } from './tasks-types.js'

// Row types — the HTTP serializers type their inputs against these (the
// schedules `Schedule` re-export precedent). Repositories stay internal.
export type { Task, TaskStatus, TaskSource } from './repositories/index.js'

export {
  TASK_CREATED,
  TASK_UPDATED,
  TASK_COMPLETED,
  TASK_DELETED,
  type TaskCreatedPayload,
  type TaskUpdatedPayload,
  type TaskCompletedPayload,
  type TaskDeletedPayload,
} from './tasks-events.js'

// CRUD + read ops (sync).
export {
  createTask,
  type CreateTaskInput,
  TASK_TITLE_MAX_LENGTH,
  TASK_DETAIL_MAX_LENGTH,
} from './lifecycle/create-task.js'
export { updateTask, type UpdateTaskInput } from './lifecycle/update-task.js'
export { deleteTask } from './lifecycle/delete-task.js'
export { listTasks, listTasksForUser } from './queries/list-tasks.js'
export { countTasksByWorkspace } from './queries/count-tasks-by-workspace.js'
export type { WorkspaceTaskCounts } from './repositories/index.js'

// The WORKING-STEPS half of the leaf (`session_todos`) — the dock above the
// chat composer. Separate rows, separate ops, one leaf
// (docs/module-notes/session-todos.md).
export type { SessionTodo, SessionTodoStatus } from './repositories/session-todos.js'

export {
  SESSION_TODOS_REPLACED,
  SESSION_TODO_UPDATED,
  SESSION_TODO_DELETED,
  type SessionTodosReplacedPayload,
  type SessionTodoUpdatedPayload,
  type SessionTodoDeletedPayload,
} from './session-todos-events.js'

export {
  replaceSessionTodos,
  type ReplaceSessionTodosInput,
  TODO_TITLE_MAX_LENGTH,
  MAX_TODOS_PER_SESSION,
} from './todos/replace-session-todos.js'
export { updateTodoStatus, type UpdateTodoStatusInput } from './todos/update-todo-status.js'
export { deleteTodo } from './todos/delete-todo.js'
export { listTodosForSession } from './todos/list-todos-for-session.js'
