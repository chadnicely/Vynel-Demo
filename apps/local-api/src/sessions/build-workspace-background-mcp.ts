// The BACKGROUND workspace turn's MCP attachment — ONE home for every headless
// turn producer that resumes a workspace's continuing conversation (schedule
// fires via `buildScheduleFireDeps`, delegated runs via `delegation-service`).
//
// WHY one home: a workspace's primary conversation is ONE resumed SDK session
// shared by every turn producer. The SDK's deferred-tool reconciliation compares
// each turn's toolset against what the session already knew — a producer that
// attaches NOTHING makes the CLI strip every `mcp__vynel*` tool and tell the
// model "MCP server disconnected" (the 2026-07-21 live bug: delegated turns ran
// bare, so the workspace brain reported the whole Vynel server offline and the
// belief persisted into later interactive turns). Every background producer must
// therefore attach the SAME background set; interactive streams alone add the
// interactive-only features (session-spawning trio, ask, ssh) on top.
//
// `@vynel/mcp` is DYNAMICALLY imported (the chat-turn/schedules precedent) — the
// descriptor pulls the SDK builder + the generated tool registry, so deferring
// keeps the static build graph light until a background turn actually needs it.

import type { Database } from '@vynel/db'
import { listEnabledCapabilities } from '@vynel/capabilities'
import type { HonoAppRequestFn } from '../factory.js'
import {
  composeSessionMcpServers,
  type ComposedSessionMcpServers,
} from './compose-session-mcp-servers.js'
import { wrapAppRequestWithDelegationThread } from './delegation-thread-header.js'
import { wrapAppRequestWithDelegationJob } from './delegation-job-header.js'
import {
  wrapAppRequestWithReportCaller,
  type ReportCaller,
} from './report-caller-header.js'
import { wrapAppRequestWithReportRequester } from './report-requester-header.js'

export type WorkspaceBackgroundMcpComposer = (input: {
  db: Database
  userId: string
  workspaceId: string
}) => ComposedSessionMcpServers

export async function buildWorkspaceBackgroundMcpComposer(
  appRequest: HonoAppRequestFn,
): Promise<WorkspaceBackgroundMcpComposer> {
  const { vynelWorkspaceDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  return ({ db, userId, workspaceId }) =>
    composeSessionMcpServers(
      [vynelWorkspaceDescriptor, notebookFeatureDescriptor],
      { db, userId, workspaceId, appRequest },
      {
        enabledCapabilityIds: new Set(
          listEnabledCapabilities(db, workspaceId).map((capability) => capability.id),
        ),
      },
    )
}

// The DELEGATED-turn composer (2026-07-21, Chad's re-decision of the ④b pin):
// a delegated WORKSPACE-ROOT turn is the user's own request arriving through
// the global root, so it carries the SAME session-routing trio the interactive
// chat has (create_session / list_sessions / send_task_to_session) — the
// global → workspace → session chain works, and the workspace primary's
// toolset stops flip-flopping per turn origin (the deferred-tool "dropped
// again" narrative).
//
// A SPAWNED-SESSION target now gets the SAME set (Chad, 2026-07-26: "all of the
// tools available to his parent will be available to the spawned session, with
// the same mode"). This REVERSES the earlier "the leaf, not a router" pin —
// which had kept spawning tools away from spawned sessions so they could not
// recurse. Chad's call, raised and settled: having a tool is not using it, and
// the two-hop chains he wants need it. There is deliberately NO depth cap.
// Permission mode already flows: the delegate routes stamp the caller's mode
// onto the job row, and the tick runs the turn under it.
//
// Schedule fires keep `buildWorkspaceBackgroundMcpComposer` above: a truly
// autonomous turn never gains spawning tools.
//
// An 'agent-session' target (persona-sessions) is the COLLEAGUE shape: same
// toolset rules as a spawned session (workspace-grounded → the interactive
// set; global-grounded → the routing set), but its caller identity is the
// agent-session kind so reports/updates resolve the colleague's requester.
export type DelegatedTurnTarget = 'workspace-root' | 'spawned-session' | 'agent-session'

export type DelegatedTurnMcpComposer = (input: {
  db: Database
  userId: string
  /** NULL for a GLOBAL-grounded spawned session — it has no workspace, and its
   *  parent is the global root, so it inherits the ROOT's toolset instead. */
  workspaceId: string | null
  target: DelegatedTurnTarget
  /** The chain this turn belongs to — stamped onto every request its tools make,
   *  so a hop from inside it CONTINUES the chain instead of starting one. */
  threadId?: string
  /** The queue row this turn is running — lets a tool report mark it, so the
   *  tick knows not to also harvest the reply. */
  jobId?: string
  /** The spawned primary a 'spawned-session' target resumes — required to stamp
   *  that turn's caller-identity header as the SESSION (session-comms fork 2:
   *  a spawned session and its grounding workspace share a workspaceId, but
   *  their requesters differ). Absent for workspace-root targets. */
  targetPrimarySessionId?: string
  /** The ORIGINATING chat's workspace (chat-mentions) — stamped as the
   *  requester-override header so this turn's reports land in the chat that
   *  asked. Absent = the standing report topology. */
  requesterWorkspaceId?: string
}) => ComposedSessionMcpServers

export async function buildDelegatedTurnMcpComposer(
  appRequest: HonoAppRequestFn,
): Promise<DelegatedTurnMcpComposer> {
  const { vynelWorkspaceInteractiveDescriptor, vynelRoutingDescriptor } = await import(
    '@vynel/mcp'
  )
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  return ({
    db,
    userId,
    workspaceId,
    target,
    targetPrimarySessionId,
    threadId,
    jobId,
    requesterWorkspaceId,
  }) => {
    // The caller identity (session-comms): stamped server-side onto every
    // request this routed turn's tools make, so the report route resolves the
    // requester from WHO is running — never from model input. A session-shaped
    // target with no primary id (a shape the tick never produces) gets NO
    // header: the tool then 400s honestly instead of mis-addressing as the
    // workspace primary.
    const caller: ReportCaller | null =
      target === 'workspace-root' && workspaceId !== null
        ? { kind: 'workspace-primary', workspaceId }
        : targetPrimarySessionId !== undefined
          ? {
              kind: target === 'agent-session' ? 'agent-session' : 'spawned-session',
              targetPrimarySessionId,
            }
          : null
    const callerAwareAppRequest =
      caller !== null ? wrapAppRequestWithReportCaller(appRequest, caller) : appRequest
    // The requester override (chat-mentions): the job recorded WHICH chat
    // asked — this turn's reports land there instead of the global root.
    const requesterAwareAppRequest =
      requesterWorkspaceId !== undefined
        ? wrapAppRequestWithReportRequester(callerAwareAppRequest, requesterWorkspaceId)
        : callerAwareAppRequest
    // Chain continuation rides the SAME dispatcher wrapping as the caller
    // identity — both are ambient turn context the model never sees.
    const threadAwareAppRequest =
      threadId !== undefined
        ? wrapAppRequestWithDelegationThread(requesterAwareAppRequest, threadId)
        : requesterAwareAppRequest
    const jobAwareAppRequest =
      jobId !== undefined
        ? wrapAppRequestWithDelegationJob(threadAwareAppRequest, jobId)
        : threadAwareAppRequest
    // A GLOBAL-grounded spawned session inherits the GLOBAL ROOT's toolset —
    // its parent's — because it has no workspace to inherit one from. It used to
    // get nothing at all, so it could not even report back. `send_message` rides
    // both surfaces, so reporting works either way.
    if (workspaceId === null) {
      return composeSessionMcpServers(
        [vynelRoutingDescriptor, notebookFeatureDescriptor],
        { db, userId, appRequest: jobAwareAppRequest },
      )
    }
    return composeSessionMcpServers(
      [vynelWorkspaceInteractiveDescriptor, notebookFeatureDescriptor],
      { db, userId, workspaceId, appRequest: jobAwareAppRequest },
      {
        enabledCapabilityIds: new Set(
          listEnabledCapabilities(db, workspaceId).map((capability) => capability.id),
        ),
      },
    )
  }
}
