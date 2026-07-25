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
// again" narrative). A SPAWNED-SESSION target stays on the plain set — it is
// the leaf doing the work, not a brain that routes further (no session
// recursion in v1). Schedule fires keep `buildWorkspaceBackgroundMcpComposer`
// above: a truly autonomous turn never gains spawning tools.
export type DelegatedTurnTarget = 'workspace-root' | 'spawned-session'

export type DelegatedTurnMcpComposer = (input: {
  db: Database
  userId: string
  workspaceId: string
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
}) => ComposedSessionMcpServers

export async function buildDelegatedTurnMcpComposer(
  appRequest: HonoAppRequestFn,
): Promise<DelegatedTurnMcpComposer> {
  const { vynelWorkspaceDescriptor, vynelWorkspaceInteractiveDescriptor } = await import(
    '@vynel/mcp'
  )
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  return ({ db, userId, workspaceId, target, targetPrimarySessionId, threadId, jobId }) => {
    // The caller identity (session-comms): stamped server-side onto every
    // request this routed turn's tools make, so `report_to_requester` resolves
    // the requester from WHO is running — never from model input. A spawned
    // target with no primary id (a shape the tick never produces) gets NO
    // header: the tool then 400s honestly instead of mis-addressing as the
    // workspace primary.
    const caller: ReportCaller | null =
      target === 'workspace-root'
        ? { kind: 'workspace-primary', workspaceId }
        : targetPrimarySessionId !== undefined
          ? { kind: 'spawned-session', targetPrimarySessionId }
          : null
    const callerAwareAppRequest =
      caller !== null ? wrapAppRequestWithReportCaller(appRequest, caller) : appRequest
    // Chain continuation rides the SAME dispatcher wrapping as the caller
    // identity — both are ambient turn context the model never sees.
    const threadAwareAppRequest =
      threadId !== undefined
        ? wrapAppRequestWithDelegationThread(callerAwareAppRequest, threadId)
        : callerAwareAppRequest
    const jobAwareAppRequest =
      jobId !== undefined
        ? wrapAppRequestWithDelegationJob(threadAwareAppRequest, jobId)
        : threadAwareAppRequest
    return composeSessionMcpServers(
      [
        target === 'workspace-root' ? vynelWorkspaceInteractiveDescriptor : vynelWorkspaceDescriptor,
        notebookFeatureDescriptor,
      ],
      { db, userId, workspaceId, appRequest: jobAwareAppRequest },
      {
        enabledCapabilityIds: new Set(
          listEnabledCapabilities(db, workspaceId).map((capability) => capability.id),
        ),
      },
    )
  }
}
