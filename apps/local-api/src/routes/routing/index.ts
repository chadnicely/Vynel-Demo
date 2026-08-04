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
import { listWorkspacesForUser } from '@vynel/workspaces'
import { listChannelsForUser, sendToChannel, replyToChannelOrigin } from '@vynel/channels'
import { listBackgroundRuns, getBackgroundRun } from '@vynel/orchestration'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  RouteToWorkspaceRequestSchema,
  SendTaskToSessionRequestSchema,
  SendToChannelRequestSchema,
  ReplyToChannelRequestSchema,
  ReplyToChannelResponseSchema,
  ReportToRequesterRequestSchema,
  ReportToRequesterResponseSchema,
  ListRoutingWorkspacesResponseSchema,
  RouteToWorkspaceResponseSchema,
  SendTaskToSessionResponseSchema,
  ListRoutingChannelsResponseSchema,
  SendToChannelResponseSchema,
  SendMessageRequestSchema,
  SendMessageResponseSchema,
  ListBackgroundRunsResponseSchema,
  BackgroundRunDetailSchema,
} from './schemas.js'
import {
  parseDelegationOriginHeader,
  DELEGATION_ORIGIN_HEADER,
} from '../../sessions/delegation-origin-header.js'
import {
  dispatchTaskToWorkspace,
  dispatchTaskToSession,
  dispatchReportToRequester,
  dispatchUpdateToRequester,
  parseMessageDestination,
} from './dispatch-message.js'

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
          'SUPERSEDED by send_message — prefer that one; this still works but will be removed. ' +
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
          'effort for hard ones; omit both for the defaults. Legal model ids come from ' +
          'list_available_chat_models.',
      },
    }),
    validator('json', RouteToWorkspaceRequestSchema),
    ...userScoped,
    async (c) => {
      const { targetWorkspaceId, task, model, thinkingEffort } = c.req.valid('json')
      const { jobId, deliveredTo } = await dispatchTaskToWorkspace(c, {
        targetWorkspaceId,
        task,
        ...(model !== undefined ? { model } : {}),
        ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
      })
      return c.json({ status: 'enqueued' as const, jobId, workspaceName: deliveredTo })
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
          'SUPERSEDED by send_message — prefer that one; this still works but will be removed. ' +
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
          'defaults. Legal model ids come from list_available_chat_models.',
      },
    }),
    validator('json', SendTaskToSessionRequestSchema),
    ...userScoped,
    async (c) => {
      const { targetSessionId, task, workspaceId, model, thinkingEffort } = c.req.valid('json')
      const { jobId, deliveredTo } = await dispatchTaskToSession(c, {
        targetSessionId,
        task,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
      })
      return c.json({ status: 'enqueued' as const, jobId, sessionName: deliveredTo })
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
          'SUPERSEDED by send_message — prefer that one; this still works but will be removed. ' +
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
      const { jobId } = await dispatchReportToRequester(c, { report })
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
  // ──────────────────────────────────────────────────────────────────
  // POST /reply-to-channel — answer the channel conversation that drove THIS turn
  //
  // The channel pipeline (locked 2026-07-27): the model calls this with nothing
  // but its answer; WHERE it goes — channel, sender, group room or DM, the
  // group message to thread onto — is the server-stamped ambient origin
  // (`x-vynel-delegation-origin`, the same header the delegate routes read).
  // The model never handles an address; a mis-addressed reply is unrecoverable.
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/reply-to-channel',
    describeRoute({
      tags: ['routing'],
      summary: 'Reply to the channel conversation that drove this turn.',
      'x-sdk-name': 'routing.replyToChannel',
      responses: {
        200: {
          description: "A queued acknowledgement: { status: 'sent', deliveredTo }.",
          content: {
            'application/json': { schema: resolver(ReplyToChannelResponseSchema) },
          },
        },
        400: {
          description:
            'This turn did not arrive via a channel, or the channel was disabled meanwhile.',
        },
        404: { description: 'Channel not found or not owned.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'reply_to_channel',
        mutatingApproved: true,
        description:
          'Reply to the channel message that started this turn — Telegram DM or group alike. ' +
          'Pass ONLY your answer as `message`; Vynel already knows which channel and which ' +
          'conversation it came from and delivers your reply exactly there (threading onto the ' +
          "asking message in groups). This is THE way a channel gets your answer — plain chat " +
          'text is never delivered. For proactive outreach on a channel that did NOT ask, use ' +
          'send_to_channel instead.',
      },
    }),
    validator('json', ReplyToChannelRequestSchema),
    ...userScoped,
    (c) => {
      const origin = parseDelegationOriginHeader(c.req.header(DELEGATION_ORIGIN_HEADER))
      if (origin === undefined) {
        throw new ValidationError(
          'This turn did not arrive via a channel — reply_to_channel only works on ' +
            'channel-driven turns. Use send_to_channel for proactive messages.',
        )
      }
      const { message } = c.req.valid('json')
      const deliveredTo = replyToChannelOrigin(c.var.db, {
        userId: c.var.user.id,
        origin,
        body: message,
      })
      return c.json({ status: 'sent' as const, deliveredTo })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /background-runs — read back the work this agent handed off
  //
  // The delegate routes above return `{ status: 'enqueued', jobId }`, and until
  // these two reads existed that jobId was a DEAD HANDLE — no tool accepted it.
  // Both are GETs over queries that already existed for the UI, so they add no
  // approval surface. `workspaceInteractiveSurface` because a workspace root
  // delegates too (send_task_to_session rides that same set): the agent that
  // can hand work off must be the agent that can read it back.
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/background-runs',
    describeRoute({
      tags: ['routing'],
      summary: 'List the work handed off to workspaces and sessions, newest first.',
      'x-sdk-name': 'routing.listBackgroundRuns',
      responses: {
        200: {
          description: 'Array of background runs with status, target, and a result preview.',
          content: {
            'application/json': { schema: resolver(ListBackgroundRunsResponseSchema) },
          },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_background_runs',
        workspaceInteractiveSurface: true,
        description:
          'List the tasks you handed off with send_task_to_workspace or send_task_to_session, ' +
          'newest first — each with its jobId, status (queued / running / completed / failed), ' +
          'where it went, and a preview of what it reported back. Use this to check on work you ' +
          "started earlier instead of assuming it finished, and to find the jobId of a run you " +
          'want the full result for. Read-only.',
      },
    }),
    ...userScoped,
    (c) => c.json(listBackgroundRuns(c.var.db, { userId: c.var.user.id })),
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /background-runs/:jobId — one run, with its FULL result text
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/background-runs/:jobId',
    describeRoute({
      tags: ['routing'],
      summary: 'Get one background run, with the full text it reported back.',
      'x-sdk-name': 'routing.getBackgroundRun',
      responses: {
        200: {
          description: 'The run, with its complete result and the task as handed off.',
          content: {
            'application/json': { schema: resolver(BackgroundRunDetailSchema) },
          },
        },
        404: { description: 'Unknown run, or not owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_background_run',
        workspaceInteractiveSurface: true,
        description:
          'Get one handed-off task by its jobId — its status and the FULL text it reported back ' +
          '(list_background_runs shows only a preview). Use it when a run has completed and you ' +
          'need its actual result, or when it failed and you need the error. Read-only.',
      },
    }),
    ...userScoped,
    (c) => {
      const run = getBackgroundRun(c.var.db, {
        userId: c.var.user.id,
        jobId: c.req.param('jobId'),
      })
      // Unknown and not-owned are the SAME 404 — a probe must not be able to
      // tell them apart (the query returns null for both).
      if (run === null) throw new NotFoundError('Background run not found')
      return c.json(run)
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /message — send_message: ONE tool for every session-to-session
  // message, replacing send_task_to_workspace / send_task_to_session /
  // report_to_requester (all three stay for one release as aliases).
  //
  // `workspaceSurface: true` alongside the routing default is what gives it ONE
  // name on EVERY surface. Routing and workspace are otherwise mutually
  // exclusive, and a comms tool that is named differently depending on who is
  // calling forces the model to choose — where choosing wrong is a silent
  // misroute, not an error.
  //
  // `kind` is derived for DOWNWARD sends ("workspace:"/"session:" = a task —
  // it cannot disagree with the destination). UPWARD sends ("requester") take
  // an optional kind: 'report' (final, marks the task reported — the default)
  // or 'update' (interim ack/progress, never marks it — persona-sessions).
  // A kind that contradicts the destination is a 400, never a silent misroute.
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/message',
    describeRoute({
      tags: ['routing'],
      summary: 'Send a message to another session — a task down, or a result back up.',
      'x-sdk-name': 'routing.sendMessage',
      responses: {
        200: {
          description: "{ status: 'enqueued', jobId, deliveredTo, kind }.",
          content: { 'application/json': { schema: resolver(SendMessageResponseSchema) } },
        },
        400: { description: 'Bad destination, or no requester on this turn.' },
        404: { description: 'Target workspace or session not found, or not owned.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'send_message',
        mutatingApproved: true,
        // NOT workspaceInteractiveSurface: the interactive descriptor composes
        // the registry (the plain workspace array) PLUS the interactive array, so
        // workspaceSurface alone already reaches interactive turns. Adding the
        // flag would also breach the standing invariant that interactive-only
        // tools never leak into the array schedule fires read.
        workspaceSurface: true,
        description:
          'Send a message to another session. This is how sessions talk to each other — use it ' +
          'instead of describing what you would like to happen.\n\n' +
          '`to` is one of:\n' +
          '- `"workspace:<workspaceId>"` — hand a task down to a workspace (ids from ' +
          'list_routing_workspaces).\n' +
          '- `"session:<sessionId>"` — hand a task to a session or agent colleague (ids from ' +
          'list_sessions).\n' +
          '- `"requester"` — speak back up to whoever asked you for this work. You never name ' +
          'them: who asked is resolved from the turn itself, so it cannot be mis-addressed.\n\n' +
          'For "requester", `kind` picks the voice: `"update"` = an interim acknowledgment or ' +
          'progress line ("Received — starting now"; the task stays running), `"report"` = the ' +
          'FINAL result — findings, numbers, paths, not just "done" (default; marks the task ' +
          'finished). Send exactly one final report per task.\n\n' +
          'Returns IMMEDIATELY with { status: "enqueued", jobId }; the other session picks the ' +
          'message up in its own conversation shortly. Track a task you sent with ' +
          'list_background_runs / get_background_run. Speaking upward only works on a ' +
          'background (delegated) turn — if there is no requester, just reply with your ' +
          'findings as text. For a task you may pick `model` (legal ids from ' +
          'list_available_chat_models) and `thinkingEffort`; omit both for the defaults.',
      },
    }),
    validator('json', SendMessageRequestSchema),
    ...userScoped,
    async (c) => {
      const { to, body, kind, model, thinkingEffort } = c.req.valid('json')
      const destination = parseMessageDestination(to)
      const taskOptions = {
        ...(model !== undefined ? { model } : {}),
        ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
      }

      // A kind that contradicts the destination is a 400 — never a misroute.
      if (destination.kind === 'requester' && kind === 'task') {
        throw new ValidationError('kind "task" cannot address "requester" — tasks go DOWN.')
      }
      if (destination.kind !== 'requester' && (kind === 'report' || kind === 'update')) {
        throw new ValidationError(
          `kind "${kind}" only addresses "requester" — a workspace/session target is a task.`,
        )
      }

      if (destination.kind === 'requester') {
        if (kind === 'update') {
          const { jobId, deliveredTo } = await dispatchUpdateToRequester(c, { update: body })
          return c.json({
            status: 'enqueued' as const,
            jobId,
            deliveredTo,
            kind: 'update' as const,
          })
        }
        const { jobId, deliveredTo } = await dispatchReportToRequester(c, { report: body })
        return c.json({ status: 'enqueued' as const, jobId, deliveredTo, kind: 'report' as const })
      }
      const { jobId, deliveredTo } =
        destination.kind === 'workspace'
          ? await dispatchTaskToWorkspace(c, {
              targetWorkspaceId: destination.workspaceId,
              task: body,
              ...taskOptions,
            })
          : await dispatchTaskToSession(c, {
              targetSessionId: destination.sessionId,
              task: body,
              ...taskOptions,
            })
      return c.json({ status: 'enqueued' as const, jobId, deliveredTo, kind: 'task' as const })
    },
  )
