// `runGlobalRootTurn` — runs a GLOBAL-ROOT turn to completion in the BACKGROUND
// (no SSE), for a channel-originated request (brain-tree Ch4). The non-streamed
// sibling of the (deferred) SSE global-root route: both reduce to
// `runGlobalRootTurnCore`, differing ONLY in the SessionSink. This file composes
// the MCP attachment at the api edge (with the origin-wrapped dispatcher so any
// delegation the root enqueues carries the origin header) and builds the DRAIN
// sink — it accumulates the answer text + captures the session id, and at the end
// (`requireResult`) throws on a missing session id or a captured in-stream error,
// so the channel runner reports failure back up to the channel.
//
// The per-user serialization (`runUnderRootTurnLock`) lives in the shared core
// (`@vynel/session/runtime`), not here — it is the sole lock acquirer (a nested
// same-user acquire on the non-reentrant lock would deadlock).
//
// The routing descriptor is the only one composed here — it carries the brain's
// tools: delegate a task to a workspace, send to a channel, list workspaces /
// channels, and register a new workspace (the mutating one — it cards). Desktop
// observation, present on the source's channel root, is intentionally out of
// scope — no desktop-notification reader is wired at boot in KLONE.

import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { runGlobalRootTurnCore, type SessionSink } from '@vynel/session/runtime'
import type { DelegationOrigin } from '@vynel/orchestration'
import type { HonoAppRequestFn } from '../factory.js'
import { composeSessionMcpServers } from './compose-session-mcp-servers.js'
import { resolveGlobalRootConversationTarget } from './resolve-global-root-conversation.js'
import { ensureGlobalRootWorkspaceDir } from './global-root-workspace.js'
import { serializeDelegationOrigin, DELEGATION_ORIGIN_HEADER } from './delegation-origin-header.js'

// The drain sink narrows on the SAME `ChatTurnEvent` the runner emits, taken
// straight off `SessionSink` so this edge never needs a `@vynel/chat` dependency.
type SessionEvent = Parameters<SessionSink['onEvent']>[0]

export interface RunGlobalRootTurnDeps {
  db: Database
  logger: Logger
  /** The in-process API dispatcher (`c.var.appRequest`) — the routing MCP tools dispatch through it. */
  appRequest: HonoAppRequestFn
}

export interface RunGlobalRootTurnInput {
  userId: string
  userMessageText: string
  /** Set when a CHANNEL drove this turn (Ch4) — threaded onto any delegation the root enqueues. */
  origin?: DelegationOrigin
  model?: string
}

export interface RunGlobalRootTurnResult {
  /** The SDK session the turn ran on (resumed or fresh). */
  sessionId: string
  /** The root's answer text — what gets delivered back to the channel. */
  resultText: string
}

/** Wrap the dispatcher so every routing request carries the origin header — the delegate route
 *  stamps it onto the enqueued job (Ch4). Exported for the header-injection unit test. */
export function wrapAppRequestWithOrigin(
  appRequest: HonoAppRequestFn,
  origin: DelegationOrigin,
): HonoAppRequestFn {
  const headerValue = serializeDelegationOrigin(origin)
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set(DELEGATION_ORIGIN_HEADER, headerValue)
    return appRequest(input, { ...init, headers })
  }
}

/** Drain sink — accumulates the answer text + captures the session id + any in-stream error.
 *  No `onError`, so a thrown setup/provider failure re-throws from the core to the caller; an
 *  in-stream `session-errored` event is surfaced as a throw by `requireResult`. */
class GlobalRootDrainSink implements SessionSink {
  private sessionId: string | null = null
  private resultText = ''
  private streamErrorMessage: string | null = null

  onEvent(event: SessionEvent): void {
    if (event.kind === 'user-message-persisted') {
      // Capture from user-message-persisted — it fires on BOTH the new AND resumed
      // branches, so every channel-brain turn (turns 2+ are resumed) sets it.
      // `session-created` fires only on a new/swapped segment, so it would leave a
      // resumed turn without a session id and `requireResult` would throw.
      this.sessionId = event.message.sessionId
    } else if (event.kind === 'text-chunk') {
      this.resultText += event.textDelta
    } else if (event.kind === 'session-errored') {
      this.streamErrorMessage = event.errorMessage
    }
  }

  /** The drained result — throws (no-session-id FIRST, then errored, matching the
   *  pre-collapse order) when the turn didn't produce a usable session. */
  requireResult(): RunGlobalRootTurnResult {
    if (this.sessionId === null) {
      throw new Error(
        'runGlobalRootTurn: the runtime did not assign a session id for the global-root turn',
      )
    }
    if (this.streamErrorMessage !== null) {
      throw new Error(`runGlobalRootTurn: the global-root turn errored: ${this.streamErrorMessage}`)
    }
    return { sessionId: this.sessionId, resultText: this.resultText.trim() }
  }
}

export async function runGlobalRootTurn(
  deps: RunGlobalRootTurnDeps,
  input: RunGlobalRootTurnInput,
): Promise<RunGlobalRootTurnResult> {
  // Origin-wrap at the edge — the core stays origin-agnostic (the additive invariant).
  const appRequest =
    input.origin !== undefined ? wrapAppRequestWithOrigin(deps.appRequest, input.origin) : deps.appRequest

  // Compose the global root's MCP attachment: the routing tools only. No workspaceId
  // — the global root has none. Dynamic import keeps the heavy SDK out of module load.
  const { vynelRoutingDescriptor } = await import('@vynel/mcp')
  const composedMcp = composeSessionMcpServers([vynelRoutingDescriptor], {
    db: deps.db,
    userId: input.userId,
    appRequest,
  })

  const sink = new GlobalRootDrainSink()
  await runGlobalRootTurnCore(
    {
      db: deps.db,
      logger: deps.logger,
      // Resolve the global root + ensure its hidden cwd, INSIDE the lock (the runner
      // calls this) — apps/local-api owns the env-coupled user-data-dir read.
      resolveTarget: async () => {
        const target = await resolveGlobalRootConversationTarget(deps.db, { userId: input.userId })
        ensureGlobalRootWorkspaceDir()
        return target
      },
    },
    {
      userId: input.userId,
      userMessageText: input.userMessageText,
      ...(input.model !== undefined ? { model: input.model } : {}),
      mcpServers: composedMcp.mcpServers,
      allowedMcpToolPatterns: composedMcp.allowedMcpToolPatterns,
      mutatingToolNames: composedMcp.mutatingToolNames,
      mcpSystemPromptAppend: composedMcp.systemPromptAppend,
    },
    sink,
  )
  return sink.requireResult()
}
