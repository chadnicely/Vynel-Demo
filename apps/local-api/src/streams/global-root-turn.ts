// SSE stream for a GLOBAL-ROOT turn. The web-facing sibling of the background
// channel runner (`runGlobalRootTurn`): both reduce to `runGlobalRootTurnCore`,
// differing ONLY in the SessionSink. This file composes the global root's MCP
// attachment at the api edge (the `streamChatTurn` precedent — composition is
// OUTSIDE streamSSE, so a composition failure surfaces as a 500 before streaming)
// and builds the SSE sink — it writes each normalized event to the stream
// verbatim (`{ event: kind, data: JSON }`), emits `turn-stream-ended` on clean
// completion, and on a thrown failure logs + emits a MINIMAL `session-errored`
// frame. That minimal frame is a DIFFERENT shape from an in-stream
// `session-errored` EVENT (which flows through `onEvent` unchanged) — the two
// error channels must stay distinct or the wire bytes drift (the additive
// invariant; see `@vynel/session/runtime`'s `SessionSink`).

import type { Context } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { Logger } from 'pino'
import type { ChatTurnEvent } from '@vynel/chat'
import { resolveTurnSessionSettings, persistTurnSessionSettings } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import {
  composeSessionAgents,
  recordAgentRunStarted,
  recordAgentRunCompleted,
} from '@vynel/orchestration'
import { defaultEnabledCapabilityIds } from '@vynel/capabilities'
import { toPermissionMode, type SessionPermissionMode } from '@vynel/session'
import {
  runGlobalRootTurnCore,
  publishTurnActivityStep,
  type SessionSink,
  type SessionTurnActivityHandle,
} from '@vynel/session/runtime'
import type { AppEnv, HonoAppRequestFn } from '../factory.js'
import { composeSessionMcpServers } from '../sessions/compose-session-mcp-servers.js'
import { createTurnSessionCarrier } from '../sessions/turn-session-header.js'
import { prepareComposerMentionTurn } from '../sessions/composer-mention-turn.js'
import { buildRecordDiscoveredModels } from '../sessions/build-record-discovered-models.js'
import { writeSseSafely } from './write-sse-safely.js'
import { resolveGlobalRootConversationTarget } from '../sessions/resolve-global-root-conversation.js'
import { ensureGlobalRootWorkspaceDir } from '../sessions/global-root-workspace.js'
import { DELEGATION_MODE_HEADER } from '../sessions/delegation-mode-header.js'
import { resolveEnabledFeatureKeys } from '../sessions/enabled-feature-keys.js'
import { resolveSessionToolPolicies } from '../sessions/session-tool-catalog.js'
import type { z } from 'zod'
import type { StartGlobalRootTurnRequestSchema } from '../routes/root/schemas.js'

type StartGlobalRootTurnInput = z.infer<typeof StartGlobalRootTurnRequestSchema>

/** Streams every `ChatTurnEvent` to the SSE stream — the SAME unified vocabulary
 *  the workspace chat streams, so the brain chat renders tool calls + thinking. The
 *  turn's terminal frame is `turn-stream-ended` (clean drain) or a minimal
 *  `session-errored` (thrown). */
class GlobalRootSseSink implements SessionSink {
  /** The turn's durable outcome (Move 3 feeder fix): a terminal
   *  `session-errored` marks it 'failed' — the workspace streams' rule
   *  (`chat-turn.ts`) the global path silently lacked, which is why a
   *  limit-errored global turn recorded a clean 'ended' envelope. Read by the
   *  caller's `activity.end(...)`. */
  turnOutcome: 'ended' | 'failed' = 'ended'

  constructor(
    private readonly stream: SSEStreamingApi,
    private readonly logger: Logger,
    /** The turn's activity-feed handle — session identity + tool-step narration. */
    private readonly activity?: SessionTurnActivityHandle,
    /** Fires with the turn's session identity the moment it is known — the
     *  mention dispatches enqueue with their provenance edge, and the ambient
     *  session header starts stamping (both idempotent downstream). */
    private readonly onSessionResolved?: (sdkSessionId: string) => void,
  ) {}

  async onEvent(event: ChatTurnEvent): Promise<void> {
    if (event.kind === 'session-errored' && !event.isRecoverable) this.turnOutcome = 'failed'
    // `user-message-persisted` fires on new AND resumed turns; `session-created`
    // only on a new/swapped segment — tap both so every turn resolves.
    if (event.kind === 'session-created') {
      this.activity?.sessionResolved(event.session.id)
      this.onSessionResolved?.(event.session.id)
    } else if (event.kind === 'user-message-persisted') {
      this.activity?.sessionResolved(event.message.sessionId)
      this.onSessionResolved?.(event.message.sessionId)
    }
    // Narrate tool steps + approval bells on the feed (the desktop overlay,
    // the activity panel).
    if (this.activity !== undefined) publishTurnActivityStep(this.activity, event)
    await this.stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
  }

  async onEnd(): Promise<void> {
    await this.stream.writeSSE({ event: 'turn-stream-ended', data: '{}' })
  }

  async onError(err: unknown): Promise<void> {
    this.turnOutcome = 'failed'
    this.logger.error({ err }, 'global-root turn stream failed')
    await writeSseSafely(
      this.stream,
      'session-errored',
      JSON.stringify({
        kind: 'session-errored',
        sessionId: '',
        errorCode: 'turn-stream-failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        isRecoverable: false,
      }),
      this.logger,
    )
    // The error path must still end the stream with the terminal frame, or the
    // client folds the error and then waits on a close that reads as clean.
    await writeSseSafely(this.stream, 'turn-stream-ended', '{}', this.logger)
  }
}

/** Wrap the dispatcher so every routing request carries the turn's permission mode —
 *  the delegate route stamps it onto the enqueued job (surface-up step 1), the way
 *  `wrapAppRequestWithOrigin` carries a channel origin. */
function wrapAppRequestWithMode(
  appRequest: HonoAppRequestFn,
  permissionMode: SessionPermissionMode,
): HonoAppRequestFn {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set(DELEGATION_MODE_HEADER, permissionMode)
    return appRequest(input, { ...init, headers })
  }
}

export async function streamGlobalRootTurn(
  c: Context<AppEnv>,
  input: StartGlobalRootTurnInput,
): Promise<Response> {
  // The global root's STABLE identity, resolved pre-lock so the desktop action
  // record can key its rows by it (the SDK id is only assigned mid-stream).
  // `getOrCreatePrimarySession` is idempotent + partial-unique race-safe, so
  // this early call cannot fight the authoritative in-lock `resolveTarget`.
  // Also the settings row: the thread's CURRENT segment carries the user's
  // persisted composer settings (swap-stable — copied forward onto fresh
  // segments), so the pre-lock read resolves the same values as the head.
  const conversationTarget = await resolveGlobalRootConversationTarget(c.var.db, {
    userId: c.var.user.id,
  })
  // A VOICE turn is a surface with PINNED parameters, not the user's chips:
  // the daemon always sends its own latency-tier model, renders no approval
  // cards (an inherited 'ask' would hang a hands-free interaction on a card
  // nobody can see), and must never stamp its pins over the user's chosen
  // settings. So voice neither reads the thread's persisted settings nor
  // writes them (the write-through below is gated the same way) — it runs on
  // its raw input + the core's defaults, byte-for-byte the pre-settings
  // behavior.
  const isVoiceTurn = input.voice === true
  const turnSettings = resolveTurnSessionSettings(
    input,
    !isVoiceTurn && conversationTarget.resumeSdkSessionId !== null
      ? findChatSessionById(c.var.db, conversationTarget.resumeSdkSessionId)
      : null,
  )
  // The turn's permission mode (surface-up step 1): governs the brain's own tools AND
  // rides the mode header so a delegation this turn enqueues inherits it. Resolved
  // input ?? the thread's persisted setting; nothing resolved → undefined → the
  // core's bypass default + no header (pre-settings behavior).
  const permissionMode =
    turnSettings.mode !== undefined ? toPermissionMode(turnSettings.mode) : undefined
  const modeAwareAppRequest =
    permissionMode !== undefined
      ? wrapAppRequestWithMode(c.var.appRequest, permissionMode)
      : c.var.appRequest
  // The turn's own session identity (`set_todos` writes the dock of exactly
  // this session). The global root resolves its conversation INSIDE the core
  // runner, so the carrier is filled from the stream's first frame.
  const turnSession = createTurnSessionCarrier()
  const appRequest = turnSession.wrapAppRequest(modeAwareAppRequest)

  // Compose the global root's MCP attachment: the routing tools (the root is a
  // MANAGER — list + delegate + channel-send). No workspaceId — the global root
  // has none. Dynamic import keeps the heavy SDK out of module load (the
  // streamChatTurn precedent).
  const { vynelRoutingDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  // ask_user here waits UNBOUNDED — this stream is the app's global chat, the
  // user is present. The background channel runner (`runGlobalRootTurn`)
  // attaches it too, with a bounded timeout.
  const { buildAskFeatureDescriptor } = await import('@vynel/asks/mcp')
  // This turn's key — turn-end cleanup cancels exactly the asks THIS turn parked.
  const askTurnKey = crypto.randomUUID()
  const askFeatureDescriptor = buildAskFeatureDescriptor({
    waiters: c.var.askWaiters,
    turnKey: askTurnKey,
    logger: c.var.logger,
  })
  // The ssh tools ride interactive streams only (module notes) and need the
  // sealing master key — no key resolved at boot means the sealed credentials
  // are unopenable, so the tools would only error: attach nothing instead.
  // Fail-closed on the TYPE too (a partial test harness leaves the var unset).
  const { buildSshFeatureDescriptor } = await import('@vynel/ssh-servers/mcp')
  const sshMasterKey = c.var.sshMasterKey
  const sshFeatureDescriptors =
    typeof sshMasterKey === 'string'
      ? [buildSshFeatureDescriptor({ masterKeyBase64: sshMasterKey, logger: c.var.logger })]
      : []
  // Desktop observation (+ gated actions) — the brain's desktop senses. The
  // descriptor excludes itself when no reader was wired at boot (off-Windows /
  // tests), so composition stays safe everywhere.
  const { desktopFeatureDescriptor, deriveDesktopPlanConsent } = await import(
    '@vynel/desktop-control'
  )
  // Chat-mentions: re-parse the message server-side — @/@Persona dispatches
  // (enqueued once the turn's session resolves) + the per-turn # study
  // descriptor. Never throws; null = a token-free turn. The global root
  // grounds agent leaves in its hidden cwd.
  const mentionPlan = await prepareComposerMentionTurn(
    c.var.db,
    {
      userId: c.var.user.id,
      userMessageText: input.userMessageText,
      originWorkspaceId: null,
      originWorkspacePath: ensureGlobalRootWorkspaceDir(),
      ...(permissionMode !== undefined ? { permissionMode } : {}),
      ...(turnSettings.model !== undefined ? { model: turnSettings.model } : {}),
      ...(turnSettings.thinkingEffort !== undefined
        ? { thinkingEffort: turnSettings.thinkingEffort }
        : {}),
    },
    { logger: c.var.logger },
  )
  const enabledFeatureKeys = resolveEnabledFeatureKeys(c.var.hubSession)
  const toolPolicies = resolveSessionToolPolicies(c.var.db, {
    userId: c.var.user.id,
    desktopToolNames: desktopFeatureDescriptor.toolNames ?? [],
  })
  const composedMcp = composeSessionMcpServers(
    [
      vynelRoutingDescriptor,
      notebookFeatureDescriptor,
      askFeatureDescriptor,
      desktopFeatureDescriptor,
      ...sshFeatureDescriptors,
      ...(mentionPlan?.studyDescriptor ? [mentionPlan.studyDescriptor] : []),
    ],
    {
      db: c.var.db,
      userId: c.var.user.id,
      sessionId: conversationTarget.primarySessionId,
      // The CHAT session (the segment this turn runs on), distinct from the
      // stable primary above — the ask row and the sessions overview key on it.
      resolveChatSessionId: turnSession.current,
      appRequest,
      desktopReader: c.var.desktopNotifications,
      enableDesktopActions: c.var.desktopActionsEnabled,
      // Plan-level approval: the turn's mode decides what an approved desktop
      // plan may authorize (ask = the card; auto/bypass = standing consent;
      // absent = display-only).
      desktopPlanConsent: deriveDesktopPlanConsent(permissionMode),
    },
    // The global root has no workspace, so no capability override rows can
    // exist for it — the catalog defaults ARE its enabled set (without this,
    // the notebook's defaultEnabled gated tools would be denied here).
    {
      enabledCapabilityIds: defaultEnabledCapabilityIds(),
      ...(enabledFeatureKeys !== undefined ? { enabledFeatureKeys } : {}),
      toolPolicies,
      surfaceKind: 'global-interactive',
    },
  )

  return streamSSE(c, async (stream) => {
    // USER-scope agents ride the global chat too — the same spawn lifecycle
    // the workspace turn gets (agents parity; workspace-scope agents stay in
    // their rooms). Composed inside the SSE callback like the rest.
    const sessionAgents = await composeSessionAgents(c.var.db, {
      userId: c.var.user.id,
      workspaceId: null,
    })
    const agentSlugs = Object.keys(sessionAgents)
    const agentRunId = agentSlugs.length > 0 ? crypto.randomUUID() : null
    if (agentRunId) {
      try {
        await recordAgentRunStarted(c.var.db, {
          runId: agentRunId,
          userId: c.var.user.id,
          workspaceId: null,
          agentSlugs,
          startedAt: new Date().toISOString(),
        })
      } catch (err) {
        c.var.logger.warn({ err }, 'failed to record agent.run-started')
      }
    }
    // Announce on the session-activity feed so other surfaces go live while
    // this turn runs (begun inside the SSE callback — the finally ends it).
    const activity = c.var.activityFeed.begin({
      userId: c.var.user.id,
      scopeKind: 'global',
      origin: input.voice === true ? 'voice' : 'web',
    })
    // Hoisted so the finally can end the feed with the DURABLE outcome — a
    // terminal session-errored records 'failed' on the turn envelope (Move 3
    // feeder fix; the workspace streams' `turnOutcome` rule).
    const sink = new GlobalRootSseSink(stream, c.var.logger, activity, (sdkSessionId) => {
      turnSession.resolve(sdkSessionId)
      mentionPlan?.onSessionResolved(sdkSessionId)
      // Settings write-through onto the resolved segment: what the composer
      // sent becomes the row's persisted truth. Input-only — omitted fields
      // stay "never set" — and NEVER for a voice turn: the daemon's pinned
      // model would silently overwrite the user's chosen chip (the
      // voice-clobber review finding). Idempotent downstream like the
      // other two callbacks.
      if (!isVoiceTurn) {
        persistTurnSessionSettings(c.var.db, sdkSessionId, input, { logger: c.var.logger })
      }
    })
    try {
      await runGlobalRootTurnCore(
        {
          db: c.var.db,
          logger: c.var.logger,
          // The brain's turns tee onto their session channel (Watch everywhere).
          turnEvents: c.var.turnEvents,
          // Resolve the global root + ensure its hidden cwd, INSIDE the lock (the
          // runner calls this) — apps/local-api owns the env-coupled user-data-dir read.
          resolveTarget: async () => {
            const target = await resolveGlobalRootConversationTarget(c.var.db, {
              userId: c.var.user.id,
            })
            ensureGlobalRootWorkspaceDir()
            return target
          },
        },
        {
          userId: c.var.user.id,
          userMessageText: input.userMessageText,
          ...(input.attachedImages !== undefined && input.attachedImages.length > 0
            ? { attachedImages: input.attachedImages }
            : {}),
          ...(turnSettings.model !== undefined ? { model: turnSettings.model } : {}),
          ...(turnSettings.thinkingEffort !== undefined
            ? { thinkingEffort: turnSettings.thinkingEffort }
            : {}),
          ...(permissionMode !== undefined ? { permissionMode } : {}),
          // A voice turn also RECORDS its origin — the transcript shows "via Voice".
          ...(input.voice === true ? { voice: true, originChannel: 'voice' as const } : {}),
          mcpServers: composedMcp.mcpServers,
          deniedMcpToolPatterns: composedMcp.deniedMcpToolPatterns,
          mutatingToolNames: composedMcp.mutatingToolNames,
          askModeApprovalToolNames: composedMcp.askModeApprovalToolNames,
          // The mention-dispatch note (chat-mentions) rides the same seam as
          // the per-feature prompt sections.
          mcpSystemPromptAppend: [composedMcp.systemPromptAppend, mentionPlan?.systemPromptAppend ?? '']
            .filter((section) => section !== '')
            .join('\n\n'),
          ...(agentSlugs.length > 0 ? { agents: sessionAgents } : {}),
          // Persist the roster the engine reports — feeds the model picker.
          onModelsDiscovered: buildRecordDiscoveredModels(c.var.db, c.var.user.id, c.var.logger),
        },
        sink,
      )
    } finally {
      activity.end(sink.turnOutcome)
      if (agentRunId) {
        try {
          await recordAgentRunCompleted(c.var.db, {
            runId: agentRunId,
            userId: c.var.user.id,
            workspaceId: null,
            completedAt: new Date().toISOString(),
          })
        } catch (err) {
          c.var.logger.warn({ err }, 'failed to record agent.run-completed')
        }
      }
      // An ask still parked when the turn ends (interrupt/disconnect) is
      // unanswerable — cancel + expire so the UI never shows a zombie wizard
      // (the streamChatTurn finally precedent).
      const cancelledAskIds = c.var.askWaiters.cancelForTurn(askTurnKey)
      if (cancelledAskIds.length > 0) {
        try {
          const { expireAskRequests } = await import('@vynel/asks')
          expireAskRequests(c.var.db, { askIds: cancelledAskIds }, { logger: c.var.logger })
        } catch (err) {
          c.var.logger.warn({ err }, 'failed to expire cancelled asks after global turn end')
        }
      }
    }
  })
}
