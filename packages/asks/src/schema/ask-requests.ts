// `ask_requests` table for the `asks` domain — one row per `ask_user` form
// Claude put in front of the user. The row is the durable half of the
// blocking bridge (the in-memory waiter registry is the other half): the UI
// polls pending rows, the answer/dismiss routes resolve them, and boot
// recovery expires rows whose awaiting process died (a pending row with no
// waiter is unanswerable — the zombie-wizard guard).
//
// Schema files import from `@vynel/db/dialect` ONLY. `userId` is the tenant
// boundary; `workspaceId` is the domain scope — nullable, NULL = the ask came
// from a global-root turn (mirrors `tasks.workspaceId`). `sessionId` is a
// LOOSE `text()` cross-domain ref (NO FK). `questionsJson`/`answersJson` are
// JSON-encoded against the `@vynel/contracts/asks` schemas — validated at
// every write boundary, never trusted on read.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export type AskRequestStatus = 'pending' | 'answered' | 'dismissed' | 'expired'

export const askRequests = table(
  'ask_requests',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: text(), // loose ref — the chat session whose turn asked
    questionsJson: text().notNull(),
    answersJson: text(), // null until answered
    status: text().$type<AskRequestStatus>().notNull(),
    createdAt: timestamp().notNull(),
    resolvedAt: timestamp(), // stamped on answered/dismissed/expired
  },
  (t) => ({
    userStatusIdx: index('idx_ask_requests_user_status').on(t.userId, t.status),
  }),
)

export type AskRequest = typeof askRequests.$inferSelect
export type NewAskRequest = typeof askRequests.$inferInsert
