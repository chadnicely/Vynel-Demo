// The `routing` HTTP surface (agent-base Slice 4 / brain-tree Chapter 1) — how sessions
// talk to each other. Top-level + user-scoped (the global root has no workspace), so it
// does NOT nest under /workspaces/:workspaceId.
//
//   GET  /routing/workspaces       -> list_routing_workspaces (read-safe; the targets)
//   POST /routing/message          -> send_message (the ONE comms tool: task down /
//                                     report + update back up; kind-aware)
//   GET  /routing/channels         -> list_routing_channels (read-safe; the send targets)
//   POST /routing/send-to-channel  -> send_to_channel (a mutating MCP tool — proactive push, Ch4 §D)
//   GET  /routing/background-runs  -> list_background_runs / get_background_run (read-safe)
//
// (The three original tools — send_task_to_workspace / send_task_to_session /
// report_to_requester — were superseded by send_message and REMOVED after one
// release as aliases; their dispatch cores live on in dispatch-message.ts.)
//
// Routes opt into MCP via `x-mcp`; the generator emits them into the SEPARATE
// `generatedRoutingMcpTools` array (path-prefix `/routing/`), so they reach ONLY
// the global-root turn's in-process server — the normal chat turn is byte-for-byte
// unchanged (the additive invariant).
//
// ASYNC pass-and-push (brain-tree Chapter 1): a task send ENQUEUES on the durable
// delegation-jobs queue and returns IMMEDIATELY — the sender frees itself (stays
// context-free) instead of blocking on the target turn. The in-process
// `delegation-service` claims the job and runs the routed turn in the background;
// the child speaks its own ack/report back up via send_message (persona-sessions).
//
// **The ROUTED TURN SURFACES ITS APPROVALS UP** (fork 3 BUILT): a carded
// (irreversible) tool RECORDS its approval and PARKS — the card reaches the web
// notifier (always) and the origin channel (when the request came from one); the
// user's decision resumes the turn (see `buildRoutedApprovalHandler`). So routing
// never performs an UNAPPROVED irreversible action — it just asks instead of
// auto-denying. The job's threaded `permissionMode` picks WHICH tools card; the
// unanswered bound is the approvals reaper.
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
  SendToChannelRequestSchema,
  ReplyToChannelRequestSchema,
  ReplyToChannelResponseSchema,
  ListRoutingWorkspacesResponseSchema,
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
  // send_message returns `{ status: 'enqueued', jobId }`, and until these two
  // reads existed that jobId was a DEAD HANDLE — no tool accepted it. Both are
  // GETs over queries that already existed for the UI, so they add no approval
  // surface. `workspaceInteractiveSurface` because a workspace root delegates
  // too: the agent that can hand work off must be the agent that can read it
  // back.
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
          'List the tasks you handed off with send_message, ' +
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
  // message (the three original tools it replaced are gone — their dispatch
  // cores live on in dispatch-message.ts).
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
      const { to, body, kind, workspaceId, model, thinkingEffort } = c.req.valid('json')
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
              // The CALLING workspace (Slice ④b, ambient-stamped by the
              // workspace surface) — the creator the job parents on.
              ...(workspaceId !== undefined ? { workspaceId } : {}),
              ...taskOptions,
            })
      return c.json({ status: 'enqueued' as const, jobId, deliveredTo, kind: 'task' as const })
    },
  )
