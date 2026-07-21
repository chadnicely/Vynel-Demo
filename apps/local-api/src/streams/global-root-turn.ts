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
//
// PHASE-NOW (the `runGlobalRootTurn` precedent): only the routing descriptor is
// composed. Desktop observation — the source's second descriptor — waits on
// `@vynel/desktop-control` being wired at boot (the `desktopNotifications` reader
// returning to `AppEnv` + the dependency landing in apps/local-api); it joins the
// descriptor list then.

import type { Context } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { Logger } from 'pino'
import type { ChatTurnEvent } from '@vynel/chat'
import {
  composeSessionAgents,
  recordAgentRunStarted,
  recordAgentRunCompleted,
} from '@vynel/orchestration'
import { defaultEnabledCapabilityIds } from '@vynel/capabilities'
import { toPermissionMode, type SessionPermissionMode } from '@vynel/session'
import { runGlobalRootTurnCore, type SessionSink } from '@vynel/session/runtime'
import type { AppEnv, HonoAppRequestFn } from '../factory.js'
import { composeSessionMcpServers } from '../sessions/compose-session-mcp-servers.js'
import { resolveGlobalRootConversationTarget } from '../sessions/resolve-global-root-conversation.js'
import { ensureGlobalRootWorkspaceDir } from '../sessions/global-root-workspace.js'
import { DELEGATION_MODE_HEADER } from '../sessions/delegation-mode-header.js'
import type { z } from 'zod'
import type { StartGlobalRootTurnRequestSchema } from '../routes/root/schemas.js'

type StartGlobalRootTurnInput = z.infer<typeof StartGlobalRootTurnRequestSchema>

/** Streams every `ChatTurnEvent` to the SSE stream — the SAME unified vocabulary
 *  the workspace chat streams, so the brain chat renders tool calls + thinking. The
 *  turn's terminal frame is `turn-stream-ended` (clean drain) or a minimal
 *  `session-errored` (thrown). */
class GlobalRootSseSink implements SessionSink {
  constructor(
    private readonly stream: SSEStreamingApi,
    private readonly logger: Logger,
    /** Called when the turn's session identity is learned (activity feed). */
    private readonly onSessionResolved?: (sessionId: string) => void,
  ) {}

  async onEvent(event: ChatTurnEvent): Promise<void> {
    // `user-message-persisted` fires on new AND resumed turns; `session-created`
    // only on a new/swapped segment — tap both so every turn resolves.
    if (event.kind === 'session-created') this.onSessionResolved?.(event.session.id)
    else if (event.kind === 'user-message-persisted')
      this.onSessionResolved?.(event.message.sessionId)
    await this.stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
  }

  async onEnd(): Promise<void> {
    await this.stream.writeSSE({ event: 'turn-stream-ended', data: '{}' })
  }

  async onError(err: unknown): Promise<void> {
    this.logger.error({ err }, 'global-root turn stream failed')
    await this.stream.writeSSE({
      event: 'session-errored',
      data: JSON.stringify({
        kind: 'session-errored',
        errorMessage: err instanceof Error ? err.message : String(err),
      }),
    })
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
  // The turn's permission mode (surface-up step 1): governs the brain's own tools AND
  // rides the mode header so a delegation this turn enqueues inherits it. Absent →
  // undefined → the core's bypass default + no header (pre-mode behavior).
  const permissionMode = input.mode !== undefined ? toPermissionMode(input.mode) : undefined
  const appRequest =
    permissionMode !== undefined
      ? wrapAppRequestWithMode(c.var.appRequest, permissionMode)
      : c.var.appRequest

  // Compose the global root's MCP attachment: the routing tools (the root is a
  // MANAGER — list + delegate + channel-send). No workspaceId — the global root
  // has none. Dynamic import keeps the heavy SDK out of module load (the
  // streamChatTurn precedent).
  const { vynelRoutingDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  // ask_user attaches to INTERACTIVE app turns only — this stream is the app's
  // global chat; the background channel runner (`runGlobalRootTurn`) stays
  // ask-free (docs/module-notes/ask.md fork #2).
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
  const composedMcp = composeSessionMcpServers(
    [
      vynelRoutingDescriptor,
      notebookFeatureDescriptor,
      askFeatureDescriptor,
      ...sshFeatureDescriptors,
    ],
    {
      db: c.var.db,
      userId: c.var.user.id,
      appRequest,
    },
    // The global root has no workspace, so no capability override rows can
    // exist for it — the catalog defaults ARE its enabled set (without this,
    // the notebook's defaultEnabled gated tools would be denied here).
    { enabledCapabilityIds: defaultEnabledCapabilityIds() },
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
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}),
          ...(permissionMode !== undefined ? { permissionMode } : {}),
          // A voice turn also RECORDS its origin — the transcript shows "via Voice".
          ...(input.voice === true ? { voice: true, originChannel: 'voice' as const } : {}),
          mcpServers: composedMcp.mcpServers,
          allowedMcpToolPatterns: composedMcp.allowedMcpToolPatterns,
          mutatingToolNames: composedMcp.mutatingToolNames,
          mcpSystemPromptAppend: composedMcp.systemPromptAppend,
          ...(agentSlugs.length > 0 ? { agents: sessionAgents } : {}),
        },
        new GlobalRootSseSink(stream, c.var.logger, activity.sessionResolved),
      )
    } finally {
      activity.end()
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
