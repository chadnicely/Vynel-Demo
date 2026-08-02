// `session_todos` table — the WORKING STEPS of one session's current work
// (Claude Code's TodoWrite semantics), a sibling of `tasks` inside the same
// work-tracking leaf. A task is a durable work item the user recognizes; a
// todo is a step of the work in flight, and the whole list is replaced each
// time the session revises it (docs/module-notes/session-todos.md).
//
// Schema files import from `@vynel/db/dialect` ONLY. `userId` is the tenant
// boundary; `workspaceId` is a loose scope label — nullable, NULL = the
// session has no workspace (the global root, a spawned session). `sessionId`
// is a LOOSE `text()` cross-domain ref (NO FK to chat sessions), like
// `tasks.sessionId`: a deleted session leaves rows here that nothing reads.
// Hard-deleted like tasks — a step is not irrecoverable user content.

import { table, id, text, integer, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export type SessionTodoStatus = 'open' | 'in-progress' | 'done'

export const sessionTodos = table(
  'session_todos',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: the session's own scope, copied from its chat-session row so
    // the value can never be model-supplied. Uses `text().references(...)`
    // since `id()` is NOT NULL by contract.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    // NOT NULL — a todo without its session has no dock to render in.
    sessionId: text().notNull(),
    title: text().notNull(),
    status: text().$type<SessionTodoStatus>().notNull(),
    // The list is ORDERED; position comes from the array the session sends.
    orderIndex: integer().notNull(),
    completedAt: timestamp(), // stamped while status is 'done'
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userSessionIdx: index('idx_session_todos_user_session').on(t.userId, t.sessionId),
  }),
)

export type SessionTodo = typeof sessionTodos.$inferSelect
export type NewSessionTodo = typeof sessionTodos.$inferInsert
