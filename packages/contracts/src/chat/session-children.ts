// What hangs off ONE conversation: the sessions it spawned, the agent
// colleagues it ran, and the tasks it sent out.
//
// The node screen's third level (session-hardening D7). Today the screen can
// draw the fleet and one project's conversations and then stops, because
// nothing composed a parent→children read — a session's children were only
// reachable through the thread-keyed delegation trace, which answers a
// different question ("what did this ONE task cause"). Nothing renders this
// yet: the door exists so the level that needs it is a UI change alone.
//
// The three kinds are exactly the deeper `SceneNodeKind`s, so a child maps to
// a dot without translation.

export const SESSION_CHILD_KINDS = ['session', 'agent-run', 'task'] as const
export type SessionChildKind = (typeof SESSION_CHILD_KINDS)[number]

/** A work item's state, in the delegated-task vocabulary the run views
 *  already use. `null` on a child SESSION: a conversation's status comes from
 *  the status pipeline every other surface reads, never from here. */
export const SESSION_CHILD_STATUSES = ['queued', 'running', 'completed', 'failed'] as const
export type SessionChildStatus = (typeof SESSION_CHILD_STATUSES)[number]

export interface SessionChild {
  kind: SessionChildKind
  /** A primary-session id for `session`; the delegation job's id otherwise. */
  id: string
  /** The conversation's name, the colleague's name, or the task's label. */
  title: string
  /** Where the child is grounded, when it is grounded in a room at all. */
  workspaceId: string | null
  status: SessionChildStatus | null
  /** ISO. When the work was enqueued, or the child session first heard from
   *  this one. */
  createdAt: string
  /** ISO, or null while it is still open. */
  finishedAt: string | null
}

export interface SessionChildren {
  /** The parent, echoed back — the conversation whose children these are. */
  sessionId: string
  children: SessionChild[]
}
