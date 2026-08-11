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
// chat has (create_session / list_sessions / send_message) — the
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

// WHICH delegated targets may drive the DESKTOP (Kafi, 2026-08-11: "the global
// primary session and his spawned session for now"). The global root already
// carries the feature at both its own turn sites; this is the spawned half —
// and it is what makes desktop autopilot possible at all, since a task handed
// to a spawned session is the only way it runs while the user does something
// else (a global-root turn holds the per-user root lock for its whole life).
//
// Deliberately a NAMED SET rather than an inline condition: Kafi asked that
// "where to use" stay easy to adjust, so widening this to 'agent-session' (the
// persona colleague) or 'workspace-root' is a one-line edit here, with no
// other site to find. Schedule fires deliberately stay out — they run through
// `buildWorkspaceBackgroundMcpComposer` and are workspace-scoped, so giving
// them desktop needs a real bridge, not a list entry.
export const DESKTOP_CAPABLE_DELEGATED_TARGETS: ReadonlySet<DelegatedTurnTarget> = new Set([
  'spawned-session',
])

/** Process-wide desktop wiring, resolved once at boot and handed to the
 *  composer. Absent (tests, off-Windows, listener idle) ⇒ the descriptor
 *  excludes itself and nothing about the turn changes. */
export interface DelegatedTurnDesktopContext {
  /** `unknown` per the descriptor contract — desktop-control casts it at its own boundary. */
  readonly desktopReader?: unknown
  readonly enableDesktopActions?: boolean
}

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
  /** The mode this turn runs under (stamped on the job at enqueue). Only the
   *  desktop feature reads it, to decide how an approved plan acquires
   *  authority. Absent = the conservative floor. */
  permissionMode?: string
}) => ComposedSessionMcpServers

export async function buildDelegatedTurnMcpComposer(
  appRequest: HonoAppRequestFn,
  desktop: DelegatedTurnDesktopContext = {},
): Promise<DelegatedTurnMcpComposer> {
  const { vynelWorkspaceInteractiveDescriptor, vynelRoutingDescriptor } = await import(
    '@vynel/mcp'
  )
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  const { desktopFeatureDescriptor, deriveDesktopPlanConsent } = await import(
    '@vynel/desktop-control'
  )
  return ({
    db,
    userId,
    workspaceId,
    target,
    targetPrimarySessionId,
    threadId,
    jobId,
    requesterWorkspaceId,
    permissionMode,
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
    // The desktop half. Attached for eligible targets on BOTH branches: the
    // desktop belongs to the USER'S MACHINE, not to a workspace, so a
    // workspace-grounded spawned session is no less entitled than a global one.
    // The descriptor self-excludes when no reader was wired (off-Windows,
    // tests), so this stays safe everywhere.
    //
    // Consent is derived from THIS TURN'S mode, through the same one-home
    // policy the global-root sites use — so the plan envelope and the approval
    // floor can never disagree about what the turn may do.
    //
    // Kafi settled the fork (2026-08-11): **in auto/bypass, no card at all** —
    // those modes ARE the standing consent, and that carries into work the user
    // delegated during the turn. So an auto/bypass delegated turn's approved
    // plan authorizes its own apps FOR THE TURN. That is strictly better than
    // the alternative it replaces: with a display-only envelope the same turn
    // still acted card-free (the floor stands down in auto/bypass), but had to
    // mint PERMANENT `desktop_app_grants` rows to do it — silently growing the
    // user's standing-access list as a side effect of one task. One-time
    // authority was the original intent (Kafi, Arc 1).
    //
    // Everything else still falls to `display-only`: a channel-origin or
    // pre-mode job carries no mode, the runner defaults it to
    // `bypass-with-behavior-gate`, and there the floor HOLDS — the plan
    // narrates, authority comes only from standing grants, and a new app parks
    // a card. "A background turn can never self-grant" survives exactly where
    // it was meant to.
    const desktopDescriptors = DESKTOP_CAPABLE_DELEGATED_TARGETS.has(target)
      ? [desktopFeatureDescriptor]
      : []
    // Conditional spreads, not possibly-undefined values: `exactOptionalPropertyTypes`
    // distinguishes "absent" from "present and undefined", and the descriptor's
    // applicability gate keys on the field being ABSENT.
    const desktopContext =
      desktopDescriptors.length > 0
        ? {
            ...(desktop.desktopReader !== undefined
              ? { desktopReader: desktop.desktopReader }
              : {}),
            ...(desktop.enableDesktopActions !== undefined
              ? { enableDesktopActions: desktop.enableDesktopActions }
              : {}),
            desktopPlanConsent: deriveDesktopPlanConsent(permissionMode),
          }
        : {}

    // A GLOBAL-grounded spawned session inherits the GLOBAL ROOT's toolset —
    // its parent's — because it has no workspace to inherit one from. It used to
    // get nothing at all, so it could not even report back. `send_message` rides
    // both surfaces, so reporting works either way.
    if (workspaceId === null) {
      return composeSessionMcpServers(
        [vynelRoutingDescriptor, notebookFeatureDescriptor, ...desktopDescriptors],
        { db, userId, appRequest: jobAwareAppRequest, ...desktopContext },
      )
    }
    return composeSessionMcpServers(
      [vynelWorkspaceInteractiveDescriptor, notebookFeatureDescriptor, ...desktopDescriptors],
      { db, userId, workspaceId, appRequest: jobAwareAppRequest, ...desktopContext },
      {
        enabledCapabilityIds: new Set(
          listEnabledCapabilities(db, workspaceId).map((capability) => capability.id),
        ),
      },
    )
  }
}
