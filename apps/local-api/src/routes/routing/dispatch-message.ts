// The ONE home for "deliver a message between sessions" — the three routing
// dispatches, extracted so the unified `send_message` tool and the three
// original routes share exactly one implementation each.
//
// WHY EXTRACTED: `send_message` needs all three resolutions (a workspace
// target, a session target, the requester). Re-deriving them beside the
// originals would guarantee drift — one site gains an ownership check the other
// forgets, and the failure is a task delivered to the wrong conversation. The
// originals now call these too, so there is nothing to keep in sync.
//
// AMBIENT CONTEXT, NEVER MODEL INPUT. Every dispatch reads the same four
// server-stamped headers: the origin channel, the permission mode, the chain
// key, and (for a report) the caller identity. A model-visible value for any of
// them could be mis-set, and a mis-addressed message is unrecoverable once
// enqueued.

import type { Context } from 'hono'
import {
  enqueueWorkspaceDelegation,
  enqueueSessionDelegation,
  enqueueReportDelivery,
  markDelegationJobReported,
  type ReportDeliveryRequester,
} from '@vynel/orchestration'
import { getWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { findSpawnedSessionById, findSpawnedSessionBySegmentId } from '@vynel/session/spawned'
import { resolveSpawnedSessionDisplayName } from '@vynel/session/delegation'
import { composeManagerSourceLabel } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import { ValidationError, NotFoundError } from '@vynel/errors'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import type { AppEnv } from '../../factory.js'
import {
  parseDelegationOriginHeader,
  DELEGATION_ORIGIN_HEADER,
} from '../../sessions/delegation-origin-header.js'
import {
  parseDelegationModeHeader,
  DELEGATION_MODE_HEADER,
} from '../../sessions/delegation-mode-header.js'
import {
  parseDelegationThreadHeader,
  DELEGATION_THREAD_HEADER,
} from '../../sessions/delegation-thread-header.js'
import {
  parseDelegationJobHeader,
  DELEGATION_JOB_HEADER,
} from '../../sessions/delegation-job-header.js'
import {
  parseReportCallerHeader,
  REPORT_CALLER_HEADER,
} from '../../sessions/report-caller-header.js'
import { resolveSpawnedSessionRunCwd } from '../../sessions/spawned-session-ground.js'

/** What a dispatch produced: the queue handle plus where it actually landed. */
export interface MessageDispatchResult {
  jobId: string
  deliveredTo: string
}

export interface TaskDispatchOptions {
  model?: string
  thinkingEffort?: ThinkingEffortLevel
}

type RoutingContext = Context<AppEnv>

/** The four server-stamped values every dispatch threads onto its job row. */
function readAmbientContext(c: RoutingContext) {
  return {
    origin: parseDelegationOriginHeader(c.req.header(DELEGATION_ORIGIN_HEADER)),
    permissionMode: parseDelegationModeHeader(c.req.header(DELEGATION_MODE_HEADER)),
    threadId: parseDelegationThreadHeader(c.req.header(DELEGATION_THREAD_HEADER)),
  }
}

function taskEnqueueExtras(c: RoutingContext, options: TaskDispatchOptions) {
  const { origin, permissionMode, threadId } = readAmbientContext(c)
  return {
    ...(origin ? { origin } : {}),
    ...(permissionMode !== undefined ? { permissionMode } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.thinkingEffort !== undefined ? { thinkingEffort: options.thinkingEffort } : {}),
  }
}

/** Hand a task DOWN to a workspace. */
export async function dispatchTaskToWorkspace(
  c: RoutingContext,
  input: { targetWorkspaceId: string; task: string } & TaskDispatchOptions,
): Promise<MessageDispatchResult> {
  // The global root must be running this turn — its current SDK session is
  // recorded on the job as the delegation's parent (the provenance edge).
  const globalRoot = findPrimaryConversation(c.var.db, { userId: c.var.user.id })
  if (!globalRoot?.currentSdkSessionId) {
    throw new ValidationError('Routing is only available during an active global-root turn.')
  }
  // Ownership-checked (NotFoundError when not owned).
  const workspace = await getWorkspaceById(c.var.db, input.targetWorkspaceId, c.var.user.id)

  const jobId = enqueueWorkspaceDelegation(c.var.db, {
    userId: c.var.user.id,
    parentSessionId: globalRoot.currentSdkSessionId,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    taskText: input.task,
    ...taskEnqueueExtras(c, input),
  })
  return { jobId, deliveredTo: workspace.name }
}

/** Hand a task ACROSS to a spawned session's continuing conversation. */
export async function dispatchTaskToSession(
  c: RoutingContext,
  input: { targetSessionId: string; task: string; workspaceId?: string } & TaskDispatchOptions,
): Promise<MessageDispatchResult> {
  // The job's parent is the CREATOR conversation — the calling workspace's
  // primary when a workspaceId is given (ownership-checked; unknown and
  // not-owned both 404), else the global root.
  const originWorkspace =
    input.workspaceId !== undefined
      ? await getWorkspaceById(c.var.db, input.workspaceId, c.var.user.id)
      : null
  const creator = findPrimaryConversation(c.var.db, {
    userId: c.var.user.id,
    workspaceId: originWorkspace?.id ?? null,
  })
  if (!creator?.currentSdkSessionId) {
    throw new ValidationError('Routing is only available during an active creator conversation.')
  }

  // Resolved from the tool-facing handle (the current segment id). Unknown /
  // not-owned / not-spawned all 404 identically.
  const spawned = findSpawnedSessionBySegmentId(c.var.db, {
    userId: c.var.user.id,
    sessionId: input.targetSessionId,
  })
  if (spawned === null) throw new NotFoundError('session', input.targetSessionId)
  const sessionName = findChatSessionById(c.var.db, input.targetSessionId)?.title ?? 'Session'

  const jobId = enqueueSessionDelegation(c.var.db, {
    userId: c.var.user.id,
    parentSessionId: creator.currentSdkSessionId,
    targetPrimarySessionId: spawned.id,
    runCwdPath: resolveSpawnedSessionRunCwd(c.var.db, spawned),
    taskText: input.task,
    ...taskEnqueueExtras(c, input),
  })
  return { jobId, deliveredTo: sessionName }
}

/** Pass a result UP to whoever requested this turn's work. */
export async function dispatchReportToRequester(
  c: RoutingContext,
  input: { report: string },
): Promise<MessageDispatchResult> {
  // WHO is reporting — ambient caller identity stamped by the delegated-turn
  // MCP composer. No header = no requester (interactive chats, schedule fires,
  // the global root): an actionable 400, never a silent drop.
  const caller = parseReportCallerHeader(c.req.header(REPORT_CALLER_HEADER))
  if (caller === undefined) {
    throw new ValidationError(
      'This turn has no requester to report to — reporting works on background (delegated) ' +
        'turns only. Reply with your findings as text instead.',
    )
  }

  let reporterSessionId: string | null
  let reporterLabel: string
  let requester: ReportDeliveryRequester
  if (caller.kind === 'spawned-session') {
    // A spawned session reports to its CREATOR: its grounding workspace's
    // primary, else the global root (a gone grounding workspace falls through —
    // upward chains terminate at the root).
    const spawned = findSpawnedSessionById(c.var.db, {
      userId: c.var.user.id,
      primarySessionId: caller.targetPrimarySessionId,
    })
    if (spawned === null) throw new NotFoundError('session', caller.targetPrimarySessionId)
    reporterSessionId = spawned.currentSdkSessionId
    reporterLabel = resolveSpawnedSessionDisplayName(c.var.db, spawned)
    const groundingWorkspace =
      spawned.workspaceId !== null
        ? await getWorkspaceById(c.var.db, spawned.workspaceId, c.var.user.id).catch(() => null)
        : null
    requester =
      groundingWorkspace !== null
        ? {
            kind: 'workspace-primary',
            workspaceId: groundingWorkspace.id,
            workspacePath: groundingWorkspace.path,
          }
        : { kind: 'global-root' }
  } else {
    // A workspace primary reports to the global root (the tree's top).
    const workspace = await getWorkspaceById(c.var.db, caller.workspaceId, c.var.user.id)
    const primary = findPrimaryConversation(c.var.db, {
      userId: c.var.user.id,
      workspaceId: workspace.id,
    })
    reporterSessionId = primary?.currentSdkSessionId ?? null
    reporterLabel = composeManagerSourceLabel(workspace.name, resolveManagerName(workspace))
    requester = { kind: 'global-root' }
  }
  if (reporterSessionId === null) {
    // The caller is mid-turn on this very conversation, so a missing link means
    // a corrupt row — fail loud rather than forging provenance.
    throw new ValidationError(
      'The calling conversation has no linked session — cannot attribute the report.',
    )
  }

  const { threadId } = readAmbientContext(c)
  const jobId = enqueueReportDelivery(c.var.db, {
    userId: c.var.user.id,
    reporterSessionId,
    reporterLabel,
    reportBody: input.report,
    requester,
    // The report belongs to the SAME chain as the task that produced it —
    // without this it would start a fresh thread and the chain would break at
    // exactly the hop threadId exists to connect.
    ...(threadId !== undefined ? { threadId } : {}),
  })

  // Mark the RUNNING row reported, so the tick does not also harvest this
  // turn's chat reply and wake the requester a second time. Absent header = not
  // a delegated turn, so there is no row to mark.
  const runningJobId = parseDelegationJobHeader(c.req.header(DELEGATION_JOB_HEADER))
  if (runningJobId !== undefined) {
    markDelegationJobReported(c.var.db, runningJobId, new Date())
  }

  return { jobId, deliveredTo: requester.kind === 'global-root' ? 'Global' : reporterLabel }
}

/** Parse the unified tool's `to` field. The shape is validated by the schema, so
 *  a bad value here is a programming error, not user input. */
export type MessageDestination =
  | { kind: 'requester' }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'session'; sessionId: string }

export function parseMessageDestination(to: string): MessageDestination {
  if (to === 'requester') return { kind: 'requester' }
  if (to.startsWith('workspace:')) {
    return { kind: 'workspace', workspaceId: to.slice('workspace:'.length) }
  }
  if (to.startsWith('session:')) {
    return { kind: 'session', sessionId: to.slice('session:'.length) }
  }
  throw new ValidationError(
    `Unrecognized destination "${to}". Use "requester", "workspace:<workspaceId>", or "session:<sessionId>".`,
  )
}
