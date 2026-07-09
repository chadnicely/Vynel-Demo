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
  ) {}

  async onEvent(event: ChatTurnEvent): Promise<void> {
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
  const composedMcp = composeSessionMcpServers([vynelRoutingDescriptor], {
    db: c.var.db,
    userId: c.var.user.id,
    appRequest,
  })

  return streamSSE(c, async (stream) => {
    await runGlobalRootTurnCore(
      {
        db: c.var.db,
        logger: c.var.logger,
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
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(permissionMode !== undefined ? { permissionMode } : {}),
        // A voice turn also RECORDS its origin — the transcript shows "via Voice".
        ...(input.voice === true ? { voice: true, originChannel: 'voice' as const } : {}),
        mcpServers: composedMcp.mcpServers,
        allowedMcpToolPatterns: composedMcp.allowedMcpToolPatterns,
        mutatingToolNames: composedMcp.mutatingToolNames,
        mcpSystemPromptAppend: composedMcp.systemPromptAppend,
      },
      new GlobalRootSseSink(stream, c.var.logger),
    )
  })
}
