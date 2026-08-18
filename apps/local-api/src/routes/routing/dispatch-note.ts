// The NOTE dispatch (session-comms, the lateral kind): `send_message` with
// kind "note" — one session or workspace telling another something, with no
// task attached. Anyone can note anyone they own: notes deliberately skip the
// own-child rule tasks enforce, because coordination ("I'm editing this file",
// "tell the planner when you finish") is exactly the cross-parent speech the
// task tree forbids. What keeps that safe is what a note CANNOT do: it creates
// no run, expects no report, marks nothing finished, and the receiving turn is
// steered to absorb, not act.
//
// SENDER RESOLUTION, ambient-first: the caller header names a delegated turn's
// speaker precisely (a spawned session speaks as ITSELF, not as its
// grounding); an interactive turn has no header and falls back to its scope —
// the ambient workspace, else the global root. The model never names who is
// speaking, so it cannot forge a sender.

import type { Context } from 'hono'
import { enqueueNoteDelivery, type NoteDeliveryTarget } from '@vynel/orchestration'
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
import { composeNoteMessageMarker } from '@vynel/contracts/chat/report-message-marker'
import { ValidationError, NotFoundError } from '@vynel/errors'
import type { AppEnv } from '../../factory.js'
import {
  parseReportCallerHeader,
  REPORT_CALLER_HEADER,
} from '../../sessions/report-caller-header.js'
import {
  parseTurnSessionHeader,
  TURN_SESSION_HEADER,
} from '../../sessions/turn-session-header.js'
import { resolveSpawnedSessionRunCwd } from '../../sessions/spawned-session-ground.js'
import { readAmbientContext, type MessageDispatchResult } from './dispatch-message.js'

type RoutingContext = Context<AppEnv>

/** WHO is speaking, resolved as one value: the session the note is FROM, the
 *  label the receiver sees, the sender's workspace (provenance + the nodes
 *  screen's "from" end), and the address a reply travels back to. `senderKind`
 *  exists for exactly one judgment — the self-note guards. */
type ResolvedNoteSender = {
  senderKind: 'global' | 'voice' | 'workspace-primary' | 'session'
  senderSessionId: string
  senderLabel: string
  senderWorkspaceId?: string
  /** Absent for the global root — it has no note address of its own. */
  replyAddress?: string
}

/** The workspace-primary sender shape — shared by the caller-header branch and
 *  the ambient-scope fallback so the two can never resolve differently. */
async function resolveWorkspacePrimarySender(
  c: RoutingContext,
  workspaceId: string,
): Promise<ResolvedNoteSender> {
  // Ownership-checked (NotFoundError when unknown or not owned).
  const workspace = await getWorkspaceById(c.var.db, workspaceId, c.var.user.id)
  const primary = findPrimaryConversation(c.var.db, {
    userId: c.var.user.id,
    workspaceId: workspace.id,
  })
  if (!primary?.currentSdkSessionId) {
    throw new ValidationError(
      'Sending a note needs an active workspace conversation to speak from.',
    )
  }
  return {
    senderKind: 'workspace-primary',
    senderSessionId: primary.currentSdkSessionId,
    senderLabel: composeManagerSourceLabel(workspace.name, resolveManagerName(workspace)),
    senderWorkspaceId: workspace.id,
    replyAddress: `workspace:${workspace.id}`,
  }
}

async function resolveNoteSender(
  c: RoutingContext,
  callingWorkspaceId: string | undefined,
): Promise<ResolvedNoteSender> {
  const caller = parseReportCallerHeader(c.req.header(REPORT_CALLER_HEADER))
  if (caller === undefined) {
    // An interactive turn / schedule fire: the ambient scope IS the sender.
    if (callingWorkspaceId !== undefined) {
      return resolveWorkspacePrimarySender(c, callingWorkspaceId)
    }
    // The VOICE thread (voice-session arc): a workspace-less interactive turn
    // whose running segment is scope 'voice' speaks as the spoken thread —
    // resolved from the ambient turn-session header, never model input. No
    // reply address: the voice thread is not a routable note target (yet).
    const turnSegmentId = parseTurnSessionHeader(c.req.header(TURN_SESSION_HEADER))
    if (turnSegmentId !== undefined) {
      const turnSegment = findChatSessionById(c.var.db, turnSegmentId)
      if (turnSegment?.scope === 'voice' && turnSegment.userId === c.var.user.id) {
        return {
          senderKind: 'voice',
          senderSessionId: turnSegmentId,
          senderLabel: 'Voice',
        }
      }
    }
    const root = findPrimaryConversation(c.var.db, { userId: c.var.user.id, workspaceId: null })
    if (!root?.currentSdkSessionId) {
      throw new ValidationError(
        'Sending a note needs an active global conversation to speak from.',
      )
    }
    // The global root receives no notes (it has no note address) — a receiver
    // that must answer it reports through its own chain instead.
    return {
      senderKind: 'global',
      senderSessionId: root.currentSdkSessionId,
      senderLabel: 'Global',
    }
  }
  if (caller.kind === 'workspace-primary') {
    return resolveWorkspacePrimarySender(c, caller.workspaceId)
  }
  if (caller.kind === 'spawned-session') {
    const spawned = findSpawnedSessionById(c.var.db, {
      userId: c.var.user.id,
      primarySessionId: caller.targetPrimarySessionId,
    })
    if (spawned === null) throw new NotFoundError('session', caller.targetPrimarySessionId)
    if (spawned.currentSdkSessionId === null) {
      throw new ValidationError(
        'The calling conversation has no linked session — cannot attribute the note.',
      )
    }
    return {
      senderKind: 'session',
      senderSessionId: spawned.currentSdkSessionId,
      senderLabel: resolveSpawnedSessionDisplayName(c.var.db, spawned),
      ...(spawned.workspaceId !== null ? { senderWorkspaceId: spawned.workspaceId } : {}),
      // The CURRENT segment id IS the routable handle — good until the sender
      // compaction-swaps; a stale address answers the same 404 an unknown one
      // does, and the receiver can re-resolve via its listing tools.
      replyAddress: `session:${spawned.currentSdkSessionId}`,
    }
  }
  const colleague = findAgentSessionById(c.var.db, {
    userId: c.var.user.id,
    primarySessionId: caller.targetPrimarySessionId,
  })
  if (colleague === null) throw new NotFoundError('session', caller.targetPrimarySessionId)
  if (colleague.currentSdkSessionId === null) {
    throw new ValidationError(
      'The calling conversation has no linked session — cannot attribute the note.',
    )
  }
  const agent =
    colleague.scopeRef !== null
      ? await resolveColleagueAgent(c.var.db, {
          userId: c.var.user.id,
          workspaceId: colleague.workspaceId,
          slug: colleague.scopeRef,
        })
      : null
  return {
    senderKind: 'session',
    senderSessionId: colleague.currentSdkSessionId,
    senderLabel: agent?.name ?? colleague.scopeRef ?? 'Agent',
    ...(colleague.workspaceId !== null ? { senderWorkspaceId: colleague.workspaceId } : {}),
    replyAddress: `session:${colleague.currentSdkSessionId}`,
  }
}

/** Send a NOTE to a workspace or a session — plain communication, enqueued and
 *  acknowledged immediately like every other message. */
export async function dispatchNote(
  c: RoutingContext,
  input: {
    destination:
      | { kind: 'workspace'; workspaceId: string }
      | { kind: 'session'; sessionId: string }
      | { kind: 'global' }
    body: string
    /** The CALLING workspace (ambiently stamped by the workspace surface). */
    workspaceId?: string
  },
): Promise<MessageDispatchResult> {
  const sender = await resolveNoteSender(c, input.workspaceId)

  let target: NoteDeliveryTarget
  let deliveredTo: string
  if (input.destination.kind === 'global') {
    // The GLOBAL conversation as receiver (voice-session arc). Self-guard
    // mirrors the others: the global root noting itself is meaningless.
    if (sender.senderKind === 'global') {
      throw new ValidationError('The global conversation cannot send a note to itself.')
    }
    target = { kind: 'global-root' }
    deliveredTo = 'Global'
  } else if (input.destination.kind === 'workspace') {
    // Ownership-checked (NotFoundError when unknown or not owned).
    const workspace = await getWorkspaceById(
      c.var.db,
      input.destination.workspaceId,
      c.var.user.id,
    )
    // Self-guard for the PRIMARY only: a session noting its own grounding
    // workspace is legitimately telling its manager something.
    if (sender.senderKind === 'workspace-primary' && workspace.id === sender.senderWorkspaceId) {
      throw new ValidationError('A workspace cannot send a note to itself.')
    }
    target = { kind: 'workspace', workspaceId: workspace.id, workspacePath: workspace.path }
    deliveredTo = workspace.name
  } else {
    const session = findRoutableSessionBySegmentId(c.var.db, {
      userId: c.var.user.id,
      sessionId: input.destination.sessionId,
    })
    if (session === null) throw new NotFoundError('session', input.destination.sessionId)
    if (input.destination.sessionId === sender.senderSessionId) {
      throw new ValidationError('A session cannot send a note to itself.')
    }
    target = {
      kind: 'session',
      targetPrimarySessionId: session.id,
      runCwdPath: resolveSpawnedSessionRunCwd(c.var.db, session),
    }
    deliveredTo = findChatSessionById(c.var.db, input.destination.sessionId)?.title ?? 'Session'
  }

  // The marker rides the stored body (the direct answer's title precedent):
  // the sender's label and reply address are enqueue-time facts, so the
  // receiver always sees who spoke and how to answer — even if the sender's
  // row changes before the note is claimed.
  const { permissionMode, threadId } = readAmbientContext(c)
  const jobId = enqueueNoteDelivery(c.var.db, {
    userId: c.var.user.id,
    senderSessionId: sender.senderSessionId,
    senderLabel: sender.senderLabel,
    ...(sender.senderWorkspaceId !== undefined
      ? { senderWorkspaceId: sender.senderWorkspaceId }
      : {}),
    target,
    noteBody: `${composeNoteMessageMarker(sender.senderLabel, sender.replyAddress)}\n\n${input.body}`,
    ...(threadId !== undefined ? { threadId } : {}),
    ...(permissionMode !== undefined ? { permissionMode } : {}),
  })
  return { jobId, deliveredTo }
}
