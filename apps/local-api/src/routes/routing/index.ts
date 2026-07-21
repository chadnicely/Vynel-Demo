// The `routing` HTTP surface (agent-base Slice 4 / brain-tree Chapter 1) — the two tools
// the GLOBAL root uses to route a task down to a workspace. Top-level + user-scoped (the
// global root has no workspace), so it does NOT nest under /workspaces/:workspaceId.
//
//   GET  /routing/workspaces       -> list_routing_workspaces (read-safe; the targets)
//   POST /routing/delegate         -> send_task_to_workspace (a mutating MCP tool)
//   POST /routing/delegate-session -> send_task_to_session (Slice ④ — same queue, spawned-session target)
//   POST /routing/report           -> report_to_requester (session-comms — the UPWARD tool;
//                                     rootSurface FALSE: it rides the plain workspace array,
//                                     never the global root, which has no requester)
//   GET  /routing/channels         -> list_routing_channels (read-safe; the send targets)
//   POST /routing/send-to-channel  -> send_to_channel (a mutating MCP tool — proactive push, Ch4 §D)
//
// Both opt into MCP via `x-mcp`; the generator emits them into the SEPARATE
// `generatedRoutingMcpTools` array (path-prefix `/routing/`), so they reach ONLY
// the global-root turn's in-process server — the normal chat turn is byte-for-byte
// unchanged (the additive invariant).
//
// ASYNC pass-and-push (brain-tree Chapter 1): `send_task_to_workspace` ENQUEUES the task on the
// durable delegation-jobs queue and returns IMMEDIATELY — the global root frees itself
// (stays context-free) instead of blocking on the workspace turn. The in-process
// `delegation-service` claims the job, runs the workspace-root turn in the background, and
// pushes the report back up as an attributed message. (Earlier this route DRAINED the turn
// synchronously; that machinery — `routeRequest` + `delegateToWorkspaceRoot` — is now reused
// UNCHANGED by the service.)
//
// `send_task_to_workspace` is mutating (POST, enqueues a background sub-session), so it carries
// `mutatingApproved: true`. **The ROUTED WORKSPACE TURN SURFACES ITS APPROVALS UP** (fork 3
// BUILT): a carded (irreversible) tool RECORDS its approval and PARKS — the card reaches the
// web notifier (always) and the origin channel (when the request came from one); the user's
// decision resumes the turn (see `buildRoutedApprovalHandler` + `@vynel/orchestration`
// `drainLeafTurn`). So routing-to-a-workspace still never performs an UNAPPROVED irreversible
// action — it just asks instead of auto-denying. The job's threaded `permissionMode` picks
// WHICH tools card; the unanswered bound is the approvals reaper.
//
// `send_to_channel` (brain-tree Ch4 §D) is a different shape: a mutating tool the GLOBAL ROOT runs
// DIRECTLY (not a routed leaf). It carries `mutatingApproved: true` and runs AUTO (uncarded) in
// Phase 1 — the owner's "auto now, card later" call. The global root has no approval surface yet
// (it was built to never card), and a proactive send to the user's OWN channels is consistent with
// the shipped channel auto-reply (which already messages those channels unapproved). A per-send
// approval card is the deferred follow-up that pairs with building the global-root approval surface.
//
// Locked Hono protocol: `describeRoute` from the local openapi.js wrapper, `validator`
// from `hono-openapi/zod`, chained methods on `factory.createApp()`.

import { resolver, validator } from 'hono-openapi/zod'
import { listWorkspacesForUser, getWorkspaceById, resolveManagerName } from '@vynel/workspaces'
import { listChannelsForUser, sendToChannel } from '@vynel/channels'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { findSpawnedSessionById, findSpawnedSessionBySegmentId } from '@vynel/session/spawned'
import { resolveSpawnedSessionDisplayName } from '@vynel/session/delegation'
import { composeManagerSourceLabel } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import {
  enqueueWorkspaceDelegation,
  enqueueSessionDelegation,
  enqueueReportDelivery,
  type ReportDeliveryRequester,
} from '@vynel/orchestration'
import { ValidationError, NotFoundError } from '@vynel/errors'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  parseDelegationOriginHeader,
  DELEGATION_ORIGIN_HEADER,
} from '../../sessions/delegation-origin-header.js'
import {
  parseDelegationModeHeader,
  DELEGATION_MODE_HEADER,
} from '../../sessions/delegation-mode-header.js'
import {
  parseReportCallerHeader,
  REPORT_CALLER_HEADER,
} from '../../sessions/report-caller-header.js'
import {
  RouteToWorkspaceRequestSchema,
  SendTaskToSessionRequestSchema,
  SendToChannelRequestSchema,
  ReportToRequesterRequestSchema,
  ReportToRequesterResponseSchema,
  ListRoutingWorkspacesResponseSchema,
  RouteToWorkspaceResponseSchema,
  SendTaskToSessionResponseSchema,
  ListRoutingChannelsResponseSchema,
  SendToChannelResponseSchema,
} from './schemas.js'
import { resolveSpawnedSessionRunCwd } from '../../sessions/spawned-session-ground.js'

export const routingApp = factory
  .createApp()
  // ──────────────────────────────────────────────────────────────────
  // GET /workspaces — the routing targets (id + name) the global root picks from
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/workspaces',
    describeRoute({
      tags: ['routing'],
      summary: "List the user's workspaces as routing targets (global-root manager view).",
      'x-sdk-name': 'routing.listWorkspaces',
      responses: {
        200: {
          description: 'Array of { id, name } routing targets.',
          content: {
            'application/json': { schema: resolver(ListRoutingWorkspacesResponseSchema) },
          },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_routing_workspaces',
        description:
          "List the user's workspaces (id + name) so the global brain can choose which workspace " +
          'to route a task to. Call this first to map a workspace name the user mentioned to its id. ' +
          'Read-only.',
      },
    }),
    ...userScoped,
    async (c) => {
      const workspaces = await listWorkspacesForUser(c.var.db, { userId: c.var.user.id })
      return c.json(workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /delegate — ENQUEUE a task for a workspace; the report arrives later
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/delegate',
    describeRoute({
      tags: ['routing'],
      summary: 'Enqueue a task for a workspace; it runs in the background and reports back.',
      'x-sdk-name': 'routing.delegate',
      responses: {
        200: {
          description: "A queued acknowledgement: { status: 'enqueued', jobId, workspaceName }.",
          content: {
            'application/json': { schema: resolver(RouteToWorkspaceResponseSchema) },
          },
        },
        400: { description: 'Routing is only available during an active global-root turn.' },
        404: { description: 'Target workspace not found or not owned.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'send_task_to_workspace',
        mutatingApproved: true,
        description:
          "Hand a task to a target workspace's own brain (its continuing conversation, with all its " +
          'context). Use list_routing_workspaces first to pick targetWorkspaceId. This returns ' +
          "IMMEDIATELY with { status: 'enqueued', jobId } — the workspace runs the task in the " +
          'BACKGROUND and its report arrives a little later as a NEW message in this conversation. Do ' +
          'NOT wait for a result here, and do NOT call this again for the same task — just tell the ' +
          'user you have handed it off. If the task needs an irreversible action (write or edit a ' +
          'file, delete, run a shell command), that action PAUSES for the user to approve — the ' +
          'approval card appears in the app and, for a channel request, in that channel; the task ' +
          'continues once they decide. You may pick the model and thinkingEffort for the task: ' +
          'choose a cheaper model / lower effort for routine tasks, a stronger model / higher ' +
          'effort for hard ones; omit both for the defaults.',
      },
    }),
    validator('json', RouteToWorkspaceRequestSchema),
    ...userScoped,
    async (c) => {
      const { targetWorkspaceId, task, model, thinkingEffort } = c.req.valid('json')

      // The global root must be running this turn — its current SDK session is recorded on
      // the job as the delegation's parent (the session.delegated edge / provenance).
      const globalRoot = findPrimaryConversation(c.var.db, { userId: c.var.user.id })
      if (!globalRoot?.currentSdkSessionId) {
        throw new ValidationError('Routing is only available during an active global-root turn.')
      }

      // Resolve + ownership-check the target workspace (NotFoundError if not owned).
      const workspace = await getWorkspaceById(c.var.db, targetWorkspaceId, c.var.user.id)

      // The ORIGIN CHANNEL (brain-tree Ch4) — set by `runGlobalRootTurn` on every routing
      // request when this turn came from a channel; absent for a web turn. Stamped onto the job
      // so the report is delivered back to where the user asked (read at the boundary, defensive).
      const origin = parseDelegationOriginHeader(c.req.header(DELEGATION_ORIGIN_HEADER))

      // The delegating turn's PERMISSION MODE (surface-up step 1) — set by the global-root
      // runner beside the origin; absent for a pre-mode caller (→ the runner's bypass default).
      const permissionMode = parseDelegationModeHeader(c.req.header(DELEGATION_MODE_HEADER))

      // ENQUEUE + return immediately (brain-tree Chapter 1, async core): hand the task to the
      // durable queue and free the global root. The delegation-service claims the job, runs
      // the workspace turn in the background, and pushes the report back up as a message — the
      // root never blocks and stays context-free.
      const jobId = enqueueWorkspaceDelegation(c.var.db, {
        userId: c.var.user.id,
        parentSessionId: globalRoot.currentSdkSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: task,
        ...(origin ? { origin } : {}),
        ...(permissionMode !== undefined ? { permissionMode } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
      })

      return c.json({ status: 'enqueued' as const, jobId, workspaceName: workspace.name })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /delegate-session — ENQUEUE a task for a spawned session (Slice ④)
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/delegate-session',
    describeRoute({
      tags: ['routing'],
      summary: 'Enqueue a task for a spawned session; it runs in the background and reports back.',
      'x-sdk-name': 'routing.delegateSession',
      responses: {
        200: {
          description: "A queued acknowledgement: { status: 'enqueued', jobId, sessionName }.",
          content: {
            'application/json': { schema: resolver(SendTaskToSessionResponseSchema) },
          },
        },
        400: { description: 'Routing is only available during an active creator conversation.' },
        404: {
          description:
            'Target session (or the given workspace) not found, not owned, or not a spawned session.',
        },
      },
      // Slice ④b: also rides WORKSPACE INTERACTIVE chat streams (the
      // workspaceInteractiveSurface flag → generatedWorkspaceInteractiveMcpTools,
      // composed only by the interactive stream's descriptor).
      'x-mcp': {
        exposed: true,
        name: 'send_task_to_session',
        mutatingApproved: true,
        workspaceInteractiveSurface: true,
        description:
          'Hand a task to a session you created with create_session (its continuing ' +
          'conversation, with its primed purpose and everything it has done since). Use ' +
          'list_sessions first to pick the sessionId and to CHECK ITS CONTEXT NUMBERS — send to ' +
          'a session with room, or create a new one. This returns IMMEDIATELY with ' +
          "{ status: 'enqueued', jobId } — the session runs the task in the BACKGROUND and its " +
          'report arrives a little later as a NEW message in this conversation. Do NOT wait for ' +
          'a result here, and do NOT call this again for the same task — just tell the user you ' +
          'have handed it off. Tasks sent to the SAME session run one at a time, in order; ' +
          'different sessions run in parallel. If the task needs an irreversible action, that ' +
          'action PAUSES for the user to approve; the task continues once they decide. You may ' +
          'pick the model and thinkingEffort for the task: choose a cheaper model / lower effort ' +
          'for routine tasks, a stronger model / higher effort for hard ones; omit both for the ' +
          'defaults.',
      },
    }),
    validator('json', SendTaskToSessionRequestSchema),
    ...userScoped,
    async (c) => {
      const { targetSessionId, task, workspaceId, model, thinkingEffort } = c.req.valid('json')

      // Slice ④b: the job's parent is the CREATOR conversation — the calling
      // workspace's primary when `workspaceId` is present (ownership-checked;
      // unknown and not-owned both 404), else the global root (the shipped
      // gate, relaxed from "the global root only" to "the creator").
      const originWorkspace =
        workspaceId !== undefined
          ? await getWorkspaceById(c.var.db, workspaceId, c.var.user.id)
          : null
      const creator = findPrimaryConversation(c.var.db, {
        userId: c.var.user.id,
        workspaceId: originWorkspace?.id ?? null,
      })
      if (!creator?.currentSdkSessionId) {
        throw new ValidationError('Routing is only available during an active creator conversation.')
      }

      // Resolve the spawned primary from the tool-facing handle (the current
      // segment id). Unknown / not-owned / not-spawned all 404 the same way.
      const spawned = findSpawnedSessionBySegmentId(c.var.db, {
        userId: c.var.user.id,
        sessionId: targetSessionId,
      })
      if (spawned === null) {
        throw new NotFoundError('session', targetSessionId)
      }
      const sessionName = findChatSessionById(c.var.db, targetSessionId)?.title ?? 'Session'

      const origin = parseDelegationOriginHeader(c.req.header(DELEGATION_ORIGIN_HEADER))
      const permissionMode = parseDelegationModeHeader(c.req.header(DELEGATION_MODE_HEADER))

      // The run cwd is the TARGET's ground, set at create (Slice ④b) —
      // resolved by the shared one-home (deleted-workspace fallback included),
      // the same read the interactive session-turn stream makes (Slice ③a).
      const jobId = enqueueSessionDelegation(c.var.db, {
        userId: c.var.user.id,
        parentSessionId: creator.currentSdkSessionId,
        targetPrimarySessionId: spawned.id,
        runCwdPath: resolveSpawnedSessionRunCwd(c.var.db, spawned),
        taskText: task,
        ...(origin ? { origin } : {}),
        ...(permissionMode !== undefined ? { permissionMode } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
      })

      return c.json({ status: 'enqueued' as const, jobId, sessionName })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /report — report a result UP to the requester (session-comms)
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/report',
    describeRoute({
      tags: ['routing'],
      summary: 'Report a result up to the conversation that requested this work.',
      'x-sdk-name': 'routing.report',
      responses: {
        200: {
          description: "A queued acknowledgement: { status: 'enqueued', jobId }.",
          content: {
            'application/json': { schema: resolver(ReportToRequesterResponseSchema) },
          },
        },
        400: {
          description:
            'This turn has no requester (interactive chats, schedule fires, the global root).',
        },
        404: { description: 'The calling session could not be resolved.' },
      },
      // rootSurface FALSE (session-comms): a /routing/ path lands on the
      // global-root surface by default, but the global root HAS no requester —
      // this tool rides the plain workspace array instead, reaching delegated
      // workspace-root turns AND (workspace-grounded) spawned-session turns.
      'x-mcp': {
        exposed: true,
        name: 'report_to_requester',
        mutatingApproved: true,
        rootSurface: false,
        description:
          'Report your REAL result up to the conversation that requested this work (your ' +
          'requester). Use it when you finish delegated work, or when a report arrives from a ' +
          'session you delegated to and its outcome should travel further up the chain. Pass ' +
          'the actual findings — data, numbers, file paths — not just "done". The requester is ' +
          'resolved automatically from who you are; you cannot choose the destination. Returns ' +
          "IMMEDIATELY with { status: 'enqueued' } — your requester absorbs the report in its " +
          'own conversation a little later. Only works on background (delegated) turns; if it ' +
          'says there is no requester, simply reply with your findings as text instead.',
      },
    }),
    validator('json', ReportToRequesterRequestSchema),
    ...userScoped,
    async (c) => {
      const { report } = c.req.valid('json')

      // WHO is reporting — the ambient caller identity the delegated-turn MCP
      // composer stamped (never model input: fork 2, no mis-addressing). No
      // header = no requester (interactive chats, schedule fires, the global
      // root) — an actionable 400, not a silent drop.
      const caller = parseReportCallerHeader(c.req.header(REPORT_CALLER_HEADER))
      if (caller === undefined) {
        throw new ValidationError(
          'This turn has no requester to report to — report_to_requester works on background ' +
            '(delegated) turns only. Reply with your findings as text instead.',
        )
      }

      let reporterSessionId: string | null
      let reporterLabel: string
      let requester: ReportDeliveryRequester
      if (caller.kind === 'spawned-session') {
        // A spawned session reports to its CREATOR: its grounding workspace's
        // primary, else the global root. A gone grounding workspace falls
        // through to the global root (upward chains terminate there — the ④b
        // missing-creator precedent, mirrored in the tick's completion path).
        const spawned = findSpawnedSessionById(c.var.db, {
          userId: c.var.user.id,
          primarySessionId: caller.targetPrimarySessionId,
        })
        if (spawned === null) {
          throw new NotFoundError('session', caller.targetPrimarySessionId)
        }
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
        // The caller is mid-turn on this very conversation, so a missing link
        // means a corrupt row — fail loud rather than forging provenance.
        throw new ValidationError(
          'The calling conversation has no linked session — cannot attribute the report.',
        )
      }

      const jobId = enqueueReportDelivery(c.var.db, {
        userId: c.var.user.id,
        reporterSessionId,
        reporterLabel,
        reportBody: report,
        requester,
      })
      return c.json({ status: 'enqueued' as const, jobId })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /channels — the user's channels (id + name + kind) the root can send to
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/channels',
    describeRoute({
      tags: ['routing'],
      summary: "List the user's channels as send targets (global-root view).",
      'x-sdk-name': 'routing.listChannels',
      responses: {
        200: {
          description: 'Array of { id, name, kind } channel targets.',
          content: {
            'application/json': { schema: resolver(ListRoutingChannelsResponseSchema) },
          },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_routing_channels',
        description:
          "List the user's connected messaging channels (id + name + kind) so the global brain " +
          'can choose which channel to send a message to. Call this first to map a channel the ' +
          'user mentioned to its id. Read-only.',
      },
    }),
    ...userScoped,
    (c) => {
      const channels = listChannelsForUser(c.var.db, c.var.user.id)
      return c.json(
        channels.map((channel) => ({
          id: channel.id,
          name: channel.displayName,
          kind: channel.channelKind,
        })),
      )
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /send-to-channel — proactively send a message to one of the user's channels
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/send-to-channel',
    describeRoute({
      tags: ['routing'],
      summary: "Send a message to one of the user's channels (proactive push).",
      'x-sdk-name': 'routing.sendToChannel',
      responses: {
        200: {
          description: "A queued acknowledgement: { status: 'sent', channelId }.",
          content: {
            'application/json': { schema: resolver(SendToChannelResponseSchema) },
          },
        },
        400: { description: 'The channel is disabled or has no allowed recipient.' },
        404: { description: 'Channel not found or not owned.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'send_to_channel',
        mutatingApproved: true,
        description:
          "Send a message to one of the user's connected channels (e.g. their Telegram). Use " +
          'list_routing_channels first to pick channelId. The message is delivered to the ' +
          "channel's owner. Returns { status: 'sent' }. Use this to proactively notify the user " +
          'on a channel, or to relay something to a channel they asked about.',
      },
    }),
    validator('json', SendToChannelRequestSchema),
    ...userScoped,
    (c) => {
      const { channelId, message } = c.req.valid('json')
      sendToChannel(c.var.db, { userId: c.var.user.id, channelId, body: message })
      return c.json({ status: 'sent' as const, channelId })
    },
  )
