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
  enqueueUpdateDelivery,
  findDelegationJobById,
  markDelegationJobReported,
  readDelegationJobOrigin,
  type DelegationOrigin,
} from '@vynel/orchestration'
import { getWorkspaceById, findWorkspaceById } from '@vynel/workspaces'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { findRoutableSessionBySegmentId } from '@vynel/session/spawned'
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
  parseTurnSessionHeader,
  TURN_SESSION_HEADER,
} from '../../sessions/turn-session-header.js'
import { resolveUpwardSender } from './resolve-upward-sender.js'
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

/** The four server-stamped values every dispatch threads onto its job row.
 *  Shared with the note dispatch (dispatch-note.ts) — one reader, never two. */
export function readAmbientContext(c: RoutingContext) {
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

/** WHO is handing a task down, and which conversation the job parents on. ONE
 *  home for both task dispatchers: they used to answer this question
 *  differently — the session dispatcher honored the calling workspace while the
 *  workspace dispatcher hardcoded the global root — so a workspace-to-workspace
 *  task recorded the ROOT as its asker and the target's report went to the root
 *  instead of back to the workspace that asked.
 *
 *  A global-root send carries no calling workspace: it parents on the root and
 *  records no requester. Read that absence narrowly — it means "nobody below
 *  the root asked", NOT "the report is bound for the root". A WORKSPACE-PRIMARY
 *  sender with no recorded requester does terminate at the root, but a grounded
 *  SESSION still falls back to its grounding workspace (`resolveRequesterWorkspace`
 *  below), so a root-tasked, workspace-grounded session reports into that
 *  workspace's chat rather than back to the root that asked. That asymmetry is
 *  pre-existing and deliberate-by-default, not established here; closing it
 *  needs a job-level "asked by the root" marker rather than a third meaning for
 *  absence. */
async function resolveTaskSender(
  c: RoutingContext,
  callingWorkspaceId: string | undefined,
): Promise<{ requesterWorkspaceId?: string; parentSessionId: string }> {
  // Ownership-checked (NotFoundError when unknown or not owned).
  const callingWorkspace =
    callingWorkspaceId !== undefined
      ? await getWorkspaceById(c.var.db, callingWorkspaceId, c.var.user.id)
      : null
  // The VOICE thread (voice-requester routing): a workspace-less send whose
  // running segment is scope 'voice' is the SPOKEN thread asking, not the
  // global root — its jobs parent on that segment, the asker stamp every
  // report door derives the requester from (`resolveVoiceRequesterOfJob`), so
  // the reports come back to the voice conversation. Resolved from the ambient
  // turn-session header, never model input (the note dispatch's precedent).
  if (callingWorkspace === null) {
    const turnSegmentId = parseTurnSessionHeader(c.req.header(TURN_SESSION_HEADER))
    if (turnSegmentId !== undefined) {
      const turnSegment = findChatSessionById(c.var.db, turnSegmentId)
      if (turnSegment?.scope === 'voice' && turnSegment.userId === c.var.user.id) {
        return { parentSessionId: turnSegmentId }
      }
    }
  }
  const creator = findPrimaryConversation(c.var.db, {
    userId: c.var.user.id,
    workspaceId: callingWorkspace?.id ?? null,
  })
  if (!creator?.currentSdkSessionId) {
    throw new ValidationError(
      callingWorkspace === null
        ? 'Routing is only available during an active global-root turn.'
        : 'Routing is only available during an active creator conversation.',
    )
  }
  return {
    ...(callingWorkspace !== null ? { requesterWorkspaceId: callingWorkspace.id } : {}),
    parentSessionId: creator.currentSdkSessionId,
  }
}

/** Hand a task DOWN to a workspace. */
export async function dispatchTaskToWorkspace(
  c: RoutingContext,
  input: {
    targetWorkspaceId: string
    task: string
    /** The CALLING workspace (ambiently stamped by the workspace surface);
     *  absent = a global-root send. */
    workspaceId?: string
  } & TaskDispatchOptions,
): Promise<MessageDispatchResult> {
  const sender = await resolveTaskSender(c, input.workspaceId)
  // Ownership-checked (NotFoundError when not owned).
  const workspace = await getWorkspaceById(c.var.db, input.targetWorkspaceId, c.var.user.id)

  const jobId = enqueueWorkspaceDelegation(c.var.db, {
    userId: c.var.user.id,
    ...sender,
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
  const sender = await resolveTaskSender(c, input.workspaceId)

  // Resolved from the tool-facing handle (the current segment id). Unknown /
  // not-owned / not-routable all 404 identically. Spawned sessions AND agent
  // colleagues both resolve (persona-sessions) — the tick picks the runner by
  // the primary's scope.
  const target = findRoutableSessionBySegmentId(c.var.db, {
    userId: c.var.user.id,
    sessionId: input.targetSessionId,
  })
  if (target === null) throw new NotFoundError('session', input.targetSessionId)

  // OWN-CHILD RULE (Kafi, 2026-08-17): a task may only target the caller's OWN
  // sessions — grounding IS parenthood, because a spawned session inherits its
  // creator's scope at birth (`create-spawned-session.ts`, locked fork 1).
  // Anything else routes through the owning manager, so the tree stays
  // Global → Workspace → Session and a cross-tasked stranger can no longer
  // report into a chat that never asked (the followup's bug 3, closed by
  // making its trigger unreachable). Owned-but-wrong-parent is an actionable
  // 400, not the unknown/foreign 404 — the caller legitimately sees this
  // session and needs to learn the route, not be told it doesn't exist.
  const callingWorkspaceId = sender.requesterWorkspaceId ?? null
  if (target.workspaceId !== callingWorkspaceId) {
    if (target.workspaceId === null) {
      throw new ValidationError(
        `Session "${input.targetSessionId}" is the global assistant's own session — a ` +
          'workspace cannot task it directly.',
      )
    }
    const owner = findWorkspaceById(c.var.db, target.workspaceId)
    throw new ValidationError(
      `Session "${input.targetSessionId}" belongs to workspace ` +
        `"${owner?.name ?? 'another workspace'}" — send the task to ` +
        `workspace:${target.workspaceId} and let its manager hand it to its own sessions.`,
    )
  }
  const sessionName = findChatSessionById(c.var.db, input.targetSessionId)?.title ?? 'Session'

  const jobId = enqueueSessionDelegation(c.var.db, {
    userId: c.var.user.id,
    ...sender,
    targetPrimarySessionId: target.id,
    runCwdPath: resolveSpawnedSessionRunCwd(c.var.db, target),
    taskText: input.task,
    ...taskEnqueueExtras(c, input),
  })
  return { jobId, deliveredTo: sessionName }
}

/** The CHANNEL the running delegated job came from (channel report protocol) —
 *  read off the job row, never the header: the origin header addresses the
 *  turn's OWN inbound conversation, while a report travels about the JOB, and
 *  those are the same only by accident. Absent header = not a delegated turn. */
function readRunningJobOrigin(
  c: RoutingContext,
): { runningJobId?: string; origin?: DelegationOrigin } {
  const runningJobId = parseDelegationJobHeader(c.req.header(DELEGATION_JOB_HEADER))
  if (runningJobId === undefined) return {}
  const job = findDelegationJobById(c.var.db, runningJobId)
  if (job === null || job.userId !== c.var.user.id) return { runningJobId }
  const origin = readDelegationJobOrigin(job)
  return { runningJobId, ...(origin !== null ? { origin } : {}) }
}

/** Pass a FINAL result UP to whoever requested this turn's work. */
export async function dispatchReportToRequester(
  c: RoutingContext,
  input: { report: string },
): Promise<MessageDispatchResult> {
  const sender = await resolveUpwardSender(c)

  const { threadId } = readAmbientContext(c)
  const { runningJobId, origin } = readRunningJobOrigin(c)
  const jobId = enqueueReportDelivery(c.var.db, {
    userId: c.var.user.id,
    reporterSessionId: sender.reporterSessionId,
    reporterLabel: sender.reporterLabel,
    reportBody: input.report,
    requester: sender.requester,
    // The report belongs to the SAME chain as the task that produced it —
    // without this it would start a fresh thread and the chain would break at
    // exactly the hop threadId exists to connect.
    ...(threadId !== undefined ? { threadId } : {}),
    // A channel drove this work, so somebody is still waiting there: the
    // requester's notify turn is what answers them (channel report protocol —
    // task completion no longer ships a line of its own).
    ...(origin !== undefined ? { origin } : {}),
  })

  // Mark the RUNNING row reported, so the tick's auto-report net does not also
  // relay this turn's final output and wake the requester a second time.
  if (runningJobId !== undefined) {
    markDelegationJobReported(c.var.db, runningJobId, new Date())
  }

  return { jobId, deliveredTo: sender.requesterLabel }
}

/** Pass a FINAL answer straight to the USER (kind `direct_to_user`): it lands
 *  on the requester's transcript as the SENDER's own message — verbatim, never
 *  narrated; the requester absorbs it silently via the catch-up net. The title
 *  leads the body, so the compact message box's teaser line IS the title and
 *  the popup shows the full text under it — no separate storage. Marks the
 *  running row reported exactly like a report: it IS the final result. */
export async function dispatchDirectToUser(
  c: RoutingContext,
  input: { message: string; title: string },
): Promise<MessageDispatchResult> {
  const sender = await resolveUpwardSender(c)

  const { threadId } = readAmbientContext(c)
  const { runningJobId, origin } = readRunningJobOrigin(c)
  const jobId = enqueueReportDelivery(c.var.db, {
    userId: c.var.user.id,
    reporterSessionId: sender.reporterSessionId,
    reporterLabel: sender.reporterLabel,
    reportBody: `${input.title.trim()}\n\n${input.message}`,
    requester: sender.requester,
    // CHANNEL-ORIGIN WORK NEVER GOES DIRECT (channel report protocol): the
    // direct path persists the answer onto the requester's transcript and runs
    // NO turn — so nobody would be left to reply to the person waiting on
    // Telegram. The answer still reaches the user; it just travels as a report,
    // through a requester turn that can answer the channel too.
    ...(origin !== undefined ? { origin } : { deliverDirectly: true }),
    ...(threadId !== undefined ? { threadId } : {}),
  })

  if (runningJobId !== undefined) {
    markDelegationJobReported(c.var.db, runningJobId, new Date())
  }

  return { jobId, deliveredTo: sender.requesterLabel }
}

/** Pass an interim ACK/STATUS update UP (persona-sessions) — same resolution as
 *  a report, but it NEVER marks the running job reported (only the final report
 *  does) and it coalesces in the queue while pending. */
export async function dispatchUpdateToRequester(
  c: RoutingContext,
  input: { update: string },
): Promise<MessageDispatchResult> {
  const sender = await resolveUpwardSender(c)

  const { threadId } = readAmbientContext(c)
  const jobId = enqueueUpdateDelivery(c.var.db, {
    userId: c.var.user.id,
    reporterSessionId: sender.reporterSessionId,
    reporterLabel: sender.reporterLabel,
    updateBody: input.update,
    requester: sender.requester,
    ...(threadId !== undefined ? { threadId } : {}),
  })

  return { jobId, deliveredTo: sender.requesterLabel }
}

/** Parse the unified tool's `to` field. The shape is validated by the schema, so
 *  a bad value here is a programming error, not user input. */
export type MessageDestination =
  | { kind: 'requester' }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'session'; sessionId: string }
  // The GLOBAL conversation as a NOTE address (voice-session arc): plain
  // communication only — the global assistant is nobody's child, so no task
  // may target it.
  | { kind: 'global' }

export function parseMessageDestination(to: string): MessageDestination {
  if (to === 'requester') return { kind: 'requester' }
  if (to === 'global') return { kind: 'global' }
  if (to.startsWith('workspace:')) {
    return { kind: 'workspace', workspaceId: to.slice('workspace:'.length) }
  }
  if (to.startsWith('session:')) {
    return { kind: 'session', sessionId: to.slice('session:'.length) }
  }
  throw new ValidationError(
    `Unrecognized destination "${to}". Use "requester", "global", "workspace:<workspaceId>", or "session:<sessionId>".`,
  )
}
