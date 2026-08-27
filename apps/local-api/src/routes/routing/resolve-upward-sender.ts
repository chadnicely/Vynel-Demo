// The addressing core for an UPWARD message (report / update / direct): who is
// speaking, and which conversation hears it. Extracted from dispatch-message.ts
// (the known-clean split recorded in the session-communication followup) so the
// dispatchers and the resolution rule each keep one readable home — the
// resolution itself is unchanged, byte-for-byte.
//
// AMBIENT CONTEXT, NEVER MODEL INPUT: everything here resolves from the two
// server-stamped caller headers. A model-visible value for either could be
// mis-set, and a mis-addressed message is unrecoverable once enqueued.

import type { Context } from 'hono'
import { findDelegationJobById, type ReportDeliveryRequester } from '@vynel/orchestration'
import { getWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { findSpawnedSessionById, findAgentSessionById } from '@vynel/session/spawned'
import {
  resolveSpawnedSessionDisplayName,
  resolveColleagueAgent,
  resolveVoiceRequesterOfJob,
} from '@vynel/session/delegation'
import { composeManagerSourceLabel } from '@vynel/chat'
import { ValidationError, NotFoundError } from '@vynel/errors'
import type { AppEnv } from '../../factory.js'
import {
  parseReportCallerHeader,
  REPORT_CALLER_HEADER,
} from '../../sessions/report-caller-header.js'
import {
  parseReportRequesterHeader,
  REPORT_REQUESTER_HEADER,
} from '../../sessions/report-requester-header.js'
import {
  parseDelegationJobHeader,
  DELEGATION_JOB_HEADER,
} from '../../sessions/delegation-job-header.js'

type RoutingContext = Context<AppEnv>

/** WHERE an upward message lands, resolved together with the name of that
 *  place. The two are produced as ONE value on purpose: the destination and its
 *  label used to be two independent statements repeated per branch, and the
 *  branch that resolved a destination without labelling it reported the
 *  SENDER's own name back as `deliveredTo` — a field whose whole job is to let
 *  the caller confirm where its message actually went. */
export type ResolvedRequester = {
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

/** The VOICE thread as the requester (voice-requester routing): when no
 *  workspace claimed the report, the RUNNING job's asker segment decides
 *  whether the spoken thread asked — read off the ambient running-job header
 *  (never model input), through the one-home derivation the engine's own
 *  pushes use (`resolveVoiceRequesterOfJob`). Null = not voice-asked, and the
 *  chain terminates at the global root as it always did. */
function resolveVoiceRequesterOfRunningJob(c: RoutingContext): ResolvedRequester | null {
  const runningJobId = parseDelegationJobHeader(c.req.header(DELEGATION_JOB_HEADER))
  if (runningJobId === undefined) return null
  const job = findDelegationJobById(c.var.db, runningJobId)
  if (job === null || job.userId !== c.var.user.id) return null
  const voice = resolveVoiceRequesterOfJob(c.var.db, job)
  if (voice === null) return null
  return {
    requester: { kind: 'voice', voicePrimarySessionId: voice.voicePrimarySessionId },
    requesterLabel: 'Voice',
  }
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
export type ResolvedUpwardSender = ResolvedRequester & {
  reporterSessionId: string
  reporterLabel: string
}

export async function resolveUpwardSender(c: RoutingContext): Promise<ResolvedUpwardSender> {
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
  // Voice wins ONLY where the chain would otherwise terminate at the root: a
  // workspace that asked keeps its report (the override/grounding above), and
  // a voice-asked job's chain ends at the spoken thread instead of the global
  // conversation (voice-requester routing).
  if (resolvedRequester.requester.kind === 'global-root') {
    const voiceRequester = resolveVoiceRequesterOfRunningJob(c)
    if (voiceRequester !== null) resolvedRequester = voiceRequester
  }
  return { reporterSessionId, reporterLabel, ...resolvedRequester }
}
