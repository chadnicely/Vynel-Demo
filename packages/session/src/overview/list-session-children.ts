// `listSessionChildren` — what hangs off ONE conversation: the sessions it
// spawned, the agent colleagues it ran, and the tasks it sent out.
//
// The node screen's third level (session-hardening D7) had no data source: a
// session's children were reachable only through the THREAD-keyed delegation
// trace, which answers "what did this one task cause". This answers "what did
// this session cause", which is the tree the picture wants.
//
// The relation is `delegation_jobs.parentSessionId` — the SDK session id of
// the turn that enqueued the job — against every segment of the asking
// conversation's chain. Two honest limits, both recorded rather than papered
// over:
//   - a spawned session that was CREATED and never tasked has no discoverable
//     parent anywhere in the schema (nothing stamps "A created B"; the
//     `session.delegated` outbox event carries the edge but is a delivery
//     mechanism with no read model). Closing that needs an additive
//     `parentPrimarySessionId` on `primary_sessions`, stamped by the spawn
//     route from the ambient turn header — a deliberate schema change, not
//     something to slip in here;
//   - delivery and note rows are messages BETWEEN conversations, not
//     children, so they are not drawn as ones. The node screen already has an
//     arc for those (`listRecentMessageEdges`).

import type { Database } from '@vynel/db'
import {
  findChatSessionById,
  listAllChatSessionsForUser,
  type ChatSession,
} from '@vynel/chat/repositories'
import { deriveDelegationTaskLabel } from '@vynel/contracts/chat/delegation-task-label'
import type {
  SessionChild,
  SessionChildStatus,
  SessionChildren,
} from '@vynel/contracts/chat/session-children'
import {
  isWorkJobKind,
  listDelegationJobsForParentSessions,
  type DelegationJob,
} from '@vynel/orchestration'
import { findPrimarySessionById } from '../repositories/index.js'

export type ListSessionChildrenInput = {
  userId: string
  /** Any segment of the conversation being asked about — the handle every
   *  other door on this surface takes. */
  sessionId: string
}

const STATUS_BY_JOB_STATUS: Record<DelegationJob['status'], SessionChildStatus> = {
  pending: 'queued',
  claimed: 'running',
  completed: 'completed',
  failed: 'failed',
}

/**
 * One conversation's children, oldest first. `null` when the session is
 * unknown or belongs to someone else — the caller answers both with the same
 * 404, so ownership never leaks through an enumeration.
 */
export function listSessionChildren(
  db: Database,
  input: ListSessionChildrenInput,
): SessionChildren | null {
  const session = findChatSessionById(db, input.sessionId)
  if (session === null || session.userId !== input.userId) return null

  const jobs = listDelegationJobsForParentSessions(db, {
    userId: input.userId,
    parentSessionIds: chainSegmentIdsOf(db, input.userId, session),
  })

  const children: SessionChild[] = []
  // A spawned child is named once, by the FIRST job that reached it — later
  // tasks to the same session are tasks, not another copy of the session.
  const seenChildSessionIds = new Set<string>()

  for (const job of jobs) {
    if (!isWorkJobKind(job.jobKind)) continue
    children.push(
      job.jobKind === 'agent-run'
        ? {
            kind: 'agent-run',
            // `workspaceName` carries the AGENT's display name on an
            // agent-run row (`enqueueAgentRun` writes it there — one column,
            // "whose name is on this job"); the slug is the fallback for a
            // colleague whose display name was never set.
            id: job.id,
            title: job.workspaceName ?? job.agentSlug ?? 'Colleague',
            workspaceId: job.workspaceId,
            status: STATUS_BY_JOB_STATUS[job.status],
            createdAt: job.createdAt.toISOString(),
            finishedAt: job.completedAt?.toISOString() ?? null,
          }
        : {
            kind: 'task',
            id: job.id,
            title: deriveDelegationTaskLabel(job.taskText),
            workspaceId: job.workspaceId,
            status: STATUS_BY_JOB_STATUS[job.status],
            createdAt: job.createdAt.toISOString(),
            finishedAt: job.completedAt?.toISOString() ?? null,
          },
    )

    const childSession = spawnedChildOf(db, input.userId, job)
    if (childSession === null || seenChildSessionIds.has(childSession.id)) continue
    seenChildSessionIds.add(childSession.id)
    children.push({
      kind: 'session',
      id: childSession.id,
      title: childSession.title,
      workspaceId: childSession.workspaceId,
      // A conversation's light comes from the status pipeline every other
      // surface reads, married with the live feed — never from this read.
      status: null,
      createdAt: job.createdAt.toISOString(),
      finishedAt: null,
    })
  }

  children.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  return { sessionId: session.id, children }
}

/** The spawned conversation a job was addressed to, or null when it was
 *  addressed to a room, to an agent colleague (that IS the agent run), to a
 *  session that has since been deleted, or to one that has not been linked to
 *  a segment yet — a conversation with no handle has no door to offer, and
 *  the task row beside it already says the work was sent. */
function spawnedChildOf(
  db: Database,
  userId: string,
  job: DelegationJob,
): { id: string; title: string; workspaceId: string | null } | null {
  if (job.targetPrimarySessionId === null) return null
  const primary = findPrimarySessionById(db, job.targetPrimarySessionId)
  if (primary === null || primary.userId !== userId || primary.scope !== 'spawned') return null
  if (primary.currentSdkSessionId === null) return null
  const segment = findChatSessionById(db, primary.currentSdkSessionId)
  if (segment === null) return null
  // The child's HANDLE, not its primary id: this is the id the caller walks
  // back down into (`/sessions/:sessionId/children`, `/turn`, `/messages`).
  return { id: segment.id, title: segment.title, workspaceId: primary.workspaceId }
}

/**
 * Every segment of the conversation `session` belongs to.
 *
 * A job carries the SDK session id of the turn that enqueued it, so a
 * conversation that has swapped context has several — asking with the head
 * alone loses every child it started before the swap, which is the same class
 * of bug the node screen's arcs had.
 *
 * Deliberately not `foldSessionChains`: that folds EVERY chain for the
 * library and drops one that is hidden end to end, which is exactly what a
 * workspace's continuing build is — the conversation most likely to be asked
 * about here.
 */
function chainSegmentIdsOf(db: Database, userId: string, session: ChatSession): string[] {
  const rows = listAllChatSessionsForUser(db, { userId })
  const byId = new Map(rows.map((row) => [row.id, row]))
  if (!byId.has(session.id)) return [session.id]

  const childByParentId = new Map<string, string>()
  for (const row of rows) {
    if (row.continuedFromSessionId === null || !byId.has(row.continuedFromSessionId)) continue
    // Rows arrive newest-first, so first-write-wins keeps the newest claimant
    // when a crashed double swap left one parent with two (the fold's rule).
    if (!childByParentId.has(row.continuedFromSessionId)) {
      childByParentId.set(row.continuedFromSessionId, row.id)
    }
  }

  const walked = new Set<string>([session.id])
  let head = session.id
  for (;;) {
    const parent = byId.get(head)?.continuedFromSessionId ?? null
    if (parent === null || !byId.has(parent) || walked.has(parent)) break
    walked.add(parent)
    head = parent
  }

  const ids: string[] = []
  const seen = new Set<string>()
  for (let id: string | undefined = head; id !== undefined; id = childByParentId.get(id)) {
    if (seen.has(id)) break
    seen.add(id)
    ids.push(id)
  }
  // A crashed double swap leaves one parent with two claimants and the fold
  // above keeps only the newest — so the very segment we were asked about can
  // be the one the forward walk steps past. Answering with a chain that
  // excludes the asked-about session would be the worst possible shape.
  if (!seen.has(session.id)) ids.push(session.id)
  return ids
}
