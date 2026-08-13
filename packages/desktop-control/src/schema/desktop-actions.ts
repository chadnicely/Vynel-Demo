// `desktop_actions` — an append-only record of what Claude actually DID on the
// user's computer. One row per act, written after the act ran.
//
// WHY it exists, in two halves that turn out to be the same artifact:
//
// 1. ACCOUNTABILITY. Per-app consent cards are retired (2026-08-13): the plan is
//    the consent, and it is approved once. What replaces the per-step card is
//    not another card — it is being able to look afterwards and see exactly what
//    happened. Kafi: "we will have desktop access log later that will show user
//    a log of claude actions only."
// 2. WHERE IT GOT TO. A task that dies mid-way used to leave nothing behind, so
//    the user could not be told how far it had come. These rows are that answer.
//
// Deliberately APPEND-ONLY, and deliberately not a "run" with a step cursor.
// Plan steps are free prose the model wrote; nothing maps a tool call back to
// "step 3", so a cursor would have to be self-reported and would be wrong. What
// actually happened is both simpler and truer — and it is what a log wants.
//
// Nothing here drives RESUMPTION. Kafi's call, and the right one: we cannot know
// whether the act that was in flight completed, and if it was "click Send" then
// re-running it sends twice. The record lets Claude tell the user where it
// stopped and ASK whether to carry on — the user decides, not the system.
//
// Schema files import from `@vynel/db/dialect` ONLY. `userId` is the tenant
// boundary. `sessionId` and `workspaceId` are LOOSE `text()` cross-feature
// refs, never FKs — the same rule `delegation_jobs.parentSessionId` follows.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'

/** Did the act do what it set out to do? `unverified` is a first-class answer,
 *  not a gap: most acts cannot be checked (a click has no read-back), and
 *  recording "we did not look" is honest where recording success would not be. */
export type DesktopActionOutcome = 'ok' | 'failed' | 'unverified'

export const desktopActions = table(
  'desktop_actions',
  {
    id: id().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** VYNEL's own stable session id (the `primary_sessions` row id) — loose
     *  ref, not an FK. NOT the SDK's session id: that one is assigned mid-stream
     *  on the global-root path, so it cannot key a record written by tools built
     *  before the stream started — and it swaps on every compaction, which would
     *  split one task's rows across ids. */
    sessionId: text(),
    /** The workspace whose task drove this act (a workspace-grounded spawned
     *  session) — loose ref, not an FK. Null for global-root and global-grounded
     *  work; it exists so the log can be filtered by workspace later. */
    workspaceId: text(),
    /** The approved plan's goal, denormalised so a single row is readable on its
     *  own. A log the user has to join to understand is a log they won't read. */
    goal: text(),
    /** Which tool acted (`act_on_app`, `launch_app`, …). */
    tool: text().notNull(),
    /** The app it acted on, as resolved — never the fuzzy query the model asked
     *  with, or the record would name something that was not touched. */
    appName: text(),
    /** What it did, in the words the overlay showed the user. */
    detail: text().notNull(),
    outcome: text().$type<DesktopActionOutcome>().notNull(),
    /** Why it failed, or what the verification actually saw. */
    note: text(),
    createdAt: timestamp().notNull(),
  },
  (columns) => [
    // The reads this table exists for: "what did Claude do on my computer"
    // (by user, newest first), "how far did that task get" (by session), and —
    // once workspaces gain desktop reach — the log filtered by workspace.
    index('desktop_actions_user_created_idx').on(columns.userId, columns.createdAt),
    index('desktop_actions_session_idx').on(columns.sessionId),
    index('desktop_actions_workspace_idx').on(columns.workspaceId),
  ],
)
