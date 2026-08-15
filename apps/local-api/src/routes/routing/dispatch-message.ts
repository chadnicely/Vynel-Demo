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
  markDelegationJobReported,
  type ReportDeliveryRequester,
} from '@vynel/orchestration'
import { getWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { findPrimaryConversation } from '@vynel/session/continuity'
import {
  findSpawnedSessionById,
  findAgentSessionById,
  findRoutableSessionBySegmentId,
} from '@vynel/session/spawned'
import {
  resolveSpawnedSessionDisplayName,
  resolveColleagueAgent,
} from '@vynel/session/delegation'
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
import {
  parseReportRequesterHeader,
  REPORT_REQUESTER_HEADER,
} from '../../sessions/report-requester-header.js'
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

/** WHERE an upward message lands, resolved together with the name of that
 *  place. The two are produced as ONE value on purpose: the destination and its
 *  label used to be two independent statements repeated per branch, and the
 *  branch that resolved a destination without labelling it reported the
 *  SENDER's own name back as `deliveredTo` — a field whose whole job is to let
 *  the caller confirm where its message actually went. */
type ResolvedRequester = {
  requester: ReportDeliveryRequester
  /** The honest `deliveredTo` — the destination, never the sender. */
  requesterLabel: string
}

/** Upward chains terminate at the global root; it is one conversation, so it
 *  needs no id — only a name to report back. */
const GLOBAL_ROOT_REQUESTER: ResolvedRequester = {
  requester: { kind: 'global-root' },
  requesterLabel: 'Global',
}

/** An already-ownership-checked requester workspace → the delivery target plus
 *  its label. `null` (no grounding, gone, foreign, or self override) falls
 *  through to the root. The single home every branch resolves through, so
 *  labelling can no longer be forgotten at one call site. */
function toResolvedRequester(
  workspace: { id: string; path: string; name: string } | null,
): ResolvedRequester {
  if (workspace === null) return GLOBAL_ROOT_REQUESTER
  return {
    requester: {
      kind: 'workspace-primary',
      workspaceId: workspace.id,
      workspacePath: workspace.path,
    },
    requesterLabel: workspace.name,
  }
}

/** Look up a candidate requester workspace, tolerating only its ABSENCE. A gone
 *  or foreign workspace legitimately falls through to the global root, where
 *  upward chains terminate — but any other failure must surface, not reroute:
 *  a swallowed DB fault would silently deliver a child's result to the global
 *  conversation and report "Global" as the destination, which is the exact
 *  misroute this layer exists to make impossible. */
async function findRequesterWorkspace(c: RoutingContext, workspaceId: string) {
  try {
    return await getWorkspaceById(c.var.db, workspaceId, c.var.user.id)
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}

/** THE requester rule, one line, every caller kind: the conversation that ASKED
 *  for this work — carried on the turn as the requester-override — else the
 *  sender's own grounding, else the global root. Chad's call (2026-08-16): one
 *  rule, no per-kind topology. Managers talk workspace-to-workspace and each
 *  distributes to its own sessions, so "whoever asked" is always the right
 *  answer and grounding is only the fallback for work nobody requested. */
async function resolveRequesterWorkspace(
  c: RoutingContext,
  groundingWorkspaceId: string | null,
  /** The SENDER's own workspace, when it IS one: a workspace primary must never
   *  reroute its report to itself — that names no one above it, and the chain
   *  still has to terminate upward at the root. */
  selfWorkspaceId?: string,
) {
  const requesterOverrideId = parseReportRequesterHeader(c.req.header(REPORT_REQUESTER_HEADER))
  const overrideWorkspace =
    requesterOverrideId !== undefined && requesterOverrideId !== selfWorkspaceId
      ? await findRequesterWorkspace(c, requesterOverrideId)
      : null
  if (overrideWorkspace !== null) return overrideWorkspace
  return groundingWorkspaceId !== null
    ? await findRequesterWorkspace(c, groundingWorkspaceId)
    : null
}

/** The resolved "from + to" of an UPWARD message (report or update): who is
 *  speaking, and which conversation hears it. ONE home for both dispatchers —
 *  a resolution rule that drifted between them would mis-address one kind. */
type ResolvedUpwardSender = ResolvedRequester & {
  reporterSessionId: string
  reporterLabel: string
}

async function resolveUpwardSender(c: RoutingContext): Promise<ResolvedUpwardSender> {
  // WHO is speaking — ambient caller identity stamped by the delegated-turn
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
  let resolvedRequester: ResolvedRequester
  if (caller.kind === 'spawned-session') {
    // A spawned session reports to whoever ASKED — the workspace that handed it
    // the task — falling back to its grounding, then the root. It used to read
    // the grounding ONLY, which silently sent a workspace-requested result to
    // the global conversation whenever the two differed.
    const spawned = findSpawnedSessionById(c.var.db, {
      userId: c.var.user.id,
      primarySessionId: caller.targetPrimarySessionId,
    })
    if (spawned === null) throw new NotFoundError('session', caller.targetPrimarySessionId)
    reporterSessionId = spawned.currentSdkSessionId
    reporterLabel = resolveSpawnedSessionDisplayName(c.var.db, spawned)
    resolvedRequester = toResolvedRequester(
      await resolveRequesterWorkspace(c, spawned.workspaceId),
    )
  } else if (caller.kind === 'agent-session') {
    // An agent COLLEAGUE (persona-sessions) reports to the chat that asked: the
    // requester-override workspace when the mention came from another chat
    // (stamped from the job row), else its grounding workspace's primary, else
    // the global root. The persona's own name is the label.
    const colleague = findAgentSessionById(c.var.db, {
      userId: c.var.user.id,
      primarySessionId: caller.targetPrimarySessionId,
    })
    if (colleague === null) throw new NotFoundError('session', caller.targetPrimarySessionId)
    reporterSessionId = colleague.currentSdkSessionId
    const agent =
      colleague.scopeRef !== null
        ? await resolveColleagueAgent(c.var.db, {
            userId: c.var.user.id,
            workspaceId: colleague.workspaceId,
            slug: colleague.scopeRef,
          })
        : null
    reporterLabel = agent?.name ?? colleague.scopeRef ?? 'Agent'
    resolvedRequester = toResolvedRequester(
      await resolveRequesterWorkspace(c, colleague.workspaceId),
    )
  } else {
    // A workspace primary reports to whoever ASKED — the workspace whose chat
    // sent the task or typed the `@persona` mention — else the global root, the
    // tree's top. It has no grounding of its own to fall back to, and it must
    // never reroute to ITSELF (that names no one above it).
    const workspace = await getWorkspaceById(c.var.db, caller.workspaceId, c.var.user.id)
    const primary = findPrimaryConversation(c.var.db, {
      userId: c.var.user.id,
      workspaceId: workspace.id,
    })
    reporterSessionId = primary?.currentSdkSessionId ?? null
    reporterLabel = composeManagerSourceLabel(workspace.name, resolveManagerName(workspace))
    resolvedRequester = toResolvedRequester(
      await resolveRequesterWorkspace(c, null, workspace.id),
    )
  }
  if (reporterSessionId === null) {
    // The caller is mid-turn on this very conversation, so a missing link means
    // a corrupt row — fail loud rather than forging provenance.
    throw new ValidationError(
      'The calling conversation has no linked session — cannot attribute the report.',
    )
  }
  return { reporterSessionId, reporterLabel, ...resolvedRequester }
}

/** Pass a FINAL result UP to whoever requested this turn's work. */
export async function dispatchReportToRequester(
  c: RoutingContext,
  input: { report: string },
): Promise<MessageDispatchResult> {
  const sender = await resolveUpwardSender(c)

  const { threadId } = readAmbientContext(c)
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
  })

  // Mark the RUNNING row reported, so the tick does not also harvest this
  // turn's chat reply and wake the requester a second time. Absent header = not
  // a delegated turn, so there is no row to mark.
  const runningJobId = parseDelegationJobHeader(c.req.header(DELEGATION_JOB_HEADER))
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
  const jobId = enqueueReportDelivery(c.var.db, {
    userId: c.var.user.id,
    reporterSessionId: sender.reporterSessionId,
    reporterLabel: sender.reporterLabel,
    reportBody: `${input.title.trim()}\n\n${input.message}`,
    requester: sender.requester,
    deliverDirectly: true,
    ...(threadId !== undefined ? { threadId } : {}),
  })

  const runningJobId = parseDelegationJobHeader(c.req.header(DELEGATION_JOB_HEADER))
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
