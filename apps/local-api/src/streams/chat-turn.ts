// SSE stream for the chat-turn route. Constructs the per-session
// in-process MCP server, then pipes the normalized chat-turn event
// generator to SSE frames. Extracted out of routes/chat/index.ts so
// the route handler stays parse-validate-call-stream-shape (the
// streaming body lived inline at ~25 LOC, mixing transport concerns
// with the route-shape standard).
//
// One file per real-time channel — first inhabitant of the folder;
// future channels (memory live-feed, knowledge index progress, etc.)
// follow this shape.

import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  startChatTurn,
  composeSessionCapabilities,
  resolvePrimaryConversationTarget,
  applyPrimaryTurnContinuity,
} from '@vynel/session/runtime'
import {
  composeSessionAgents,
  recordAgentRunStarted,
  recordAgentRunCompleted,
} from '@vynel/orchestration'
import { listEnabledCapabilities } from '@vynel/capabilities'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { toPermissionMode, DEFAULT_SESSION_MODE } from '@vynel/session'
import { findChatSessionById } from '@vynel/chat/repositories'
import type { AppEnv } from '../factory.js'
import { loadEnv } from '../env.js'
import { composeSessionMcpServers } from '../sessions/compose-session-mcp-servers.js'
import type { z } from 'zod'
import type { StartChatTurnRequestSchema } from '../routes/chat/schemas.js'

type StartChatTurnInput = z.infer<typeof StartChatTurnRequestSchema>

export async function streamChatTurn(
  c: Context<AppEnv>,
  input: StartChatTurnInput,
): Promise<Response> {
  // Compose THIS chat session's MCP attachment. A workspace turn gets the full
  // route-derived `vynel` server (auto-allowed via the `mcp__vynel__*` wildcard);
  // a disabled capability's tools are DENIED via the descriptor's capabilityGatedTools
  // + the enabled-capability set. The composer is the single per-turn step for
  // servers + allow + deny; the system prompt still comes from composeSessionCapabilities
  // below (memory snapshot etc.). Dynamic import keeps the heavy SDK out of module load.
  const { vynelWorkspaceDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  // ask_user attaches to INTERACTIVE app turns only (this stream + the global
  // chat stream) — never schedule fires or channel turns, where nobody is
  // looking at the app to answer (docs/module-notes/ask.md fork #2).
  const { buildAskFeatureDescriptor } = await import('@vynel/asks/mcp')
  // This turn's key — turn-end cleanup cancels exactly the asks THIS turn
  // parked (never a concurrent sibling turn's in the same workspace).
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
  const enabledCapabilityIds = new Set(
    listEnabledCapabilities(c.var.db, c.var.workspace!.id).map((capability) => capability.id),
  )
  const composedMcp = composeSessionMcpServers(
    [
      vynelWorkspaceDescriptor,
      notebookFeatureDescriptor,
      askFeatureDescriptor,
      ...sshFeatureDescriptors,
    ],
    {
      db: c.var.db,
      userId: c.var.user.id,
      workspaceId: c.var.workspace!.id,
      appRequest: c.var.appRequest,
    },
    { enabledCapabilityIds },
  )

  // Primary-as-thread (Slice 1) + continue-mode activation (Slice 2): when the
  // turn runs on the workspace's continuing PRIMARY conversation AND the
  // workspace has continue-mode enabled, resolve the stable primary + the SDK
  // session to resume. The active conversation follows the primary, so a swap
  // underneath stays invisible. continueEnabled is the per-workspace off-switch
  // — when off, a `continueRoot` request is ignored and this is a normal
  // session turn. Any non-primary turn (resume by id, or new) is byte-for-byte
  // today's behavior.
  const isContinueActive = input.continueRoot === true && c.var.workspace!.continueEnabled
  const primaryTarget = isContinueActive
    ? await resolvePrimaryConversationTarget(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
    : null
  const resumeSessionId = primaryTarget
    ? (primaryTarget.resumeSdkSessionId ?? undefined)
    : input.resumeSessionId
  // Dev/test swap-trigger override (Slice 2 live UI smoke); unset → production 0.85.
  const pressureThreshold = loadEnv().VYNEL_CONTEXT_PRESSURE_THRESHOLD

  return streamSSE(c, async (stream) => {
    const composed = composeSessionCapabilities(c.var.db, { workspaceId: c.var.workspace!.id })
    // Compose the enabled agents for this session (Mode A — the root model
    // delegates to them via the SDK Agent tool). Every irreversible
    // (sub)agent tool call still cards via the always-on PreToolUse backstop.
    const sessionAgents = await composeSessionAgents(c.var.db, {
      userId: c.var.user.id,
      workspaceId: c.var.workspace!.id,
    })
    const agentSlugs = Object.keys(sessionAgents)
    // Agent-run lifecycle for the future monitor (Phase-1 granularity =
    // per-orchestrated-turn; the monitor piece deepens to per-subagent).
    // Best-effort — a telemetry write must never break the user's turn.
    const agentRunId = agentSlugs.length > 0 ? crypto.randomUUID() : null
    if (agentRunId) {
      try {
        await recordAgentRunStarted(c.var.db, {
          runId: agentRunId,
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          agentSlugs,
          startedAt: new Date().toISOString(),
        })
      } catch (err) {
        c.var.logger.warn({ err }, 'failed to record agent.run-started')
      }
    }
    // Primary-continuity bookkeeping captured from the stream: the SDK session
    // the turn actually ran on, and its final context occupancy (input + cache).
    let effectiveSdkSessionId: string | null = resumeSessionId ?? null
    let occupancyTokens = 0

    const turnStream = startChatTurn(
      c.var.db,
      {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        workspacePath: c.var.workspace!.path,
        providerId: DEFAULT_PROVIDER_ID,
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        userMessageText: input.userMessageText,
        ...(input.attachedImages !== undefined ? { attachedImages: input.attachedImages } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        // Map the user-facing session mode → provider permission mode. The
        // default is resolved here (DEFAULT_SESSION_MODE today; the persisted
        // per-user setting once that lands). The irreversible floor still cards
        // in every mode via the provider's always-on PreToolUse backstop.
        permissionMode: toPermissionMode(input.mode ?? DEFAULT_SESSION_MODE),
        mcpServers: composedMcp.mcpServers,
        allowedMcpToolPatterns: composedMcp.allowedMcpToolPatterns,
        // Deny a disabled capability's tools (from the composer); the system prompt
        // joins composeSessionCapabilities (Vynel operating-rules + memory snapshot
        // etc.) with the MCP composer's per-feature prompt sections (notebook /
        // tasks / ask standing lines). The MCP half used to be dropped here — a
        // silent divergence from the global-root stream (found in the ask build;
        // the notebook's standing line never reached workspace turns).
        deniedToolNames: composedMcp.deniedMcpToolPatterns,
        systemPromptAppend: [composed.systemPromptAppend, composedMcp.systemPromptAppend]
          .filter((section) => section !== '')
          .join('\n\n'),
        // A feature's declared mutating tools card even under bypass (additive to
        // the provider's static floor).
        ...(composedMcp.mutatingToolNames.length > 0
          ? { alwaysRequireApprovalToolNames: composedMcp.mutatingToolNames }
          : {}),
        // Only attach when the workspace has enabled agents — keep the SDK
        // options clean for the common no-agents turn.
        ...(Object.keys(sessionAgents).length > 0 ? { agents: sessionAgents } : {}),
      },
      { logger: c.var.logger },
    )
    // Announce this turn on the session-activity feed so OTHER surfaces (a
    // second tab, the workspace thread elsewhere) go live while it runs.
    // Begun IMMEDIATELY before the try — nothing throwable may sit between
    // begin and the finally's end, or a composition failure leaks a
    // process-lifetime zombie turn (the feed replays in-flight turns to every
    // subscriber). The generator call above is lazy, so begin sits after it.
    const activity = c.var.activityFeed.begin({
      userId: c.var.user.id,
      scopeKind: 'workspace',
      workspaceId: c.var.workspace!.id,
      ...(resumeSessionId !== undefined ? { sessionId: resumeSessionId } : {}),
      origin: 'web',
    })
    try {
      for await (const event of turnStream) {
        // Track the session the turn ran on (a NEW session's id is only known
        // at session-created) + the latest context occupancy (last usage wins).
        if (event.kind === 'session-created') {
          effectiveSdkSessionId = event.session.id
          activity.sessionResolved(event.session.id)
        } else if (event.kind === 'user-message-persisted') {
          // A resumed turn never emits session-created — this is its identity.
          activity.sessionResolved(event.message.sessionId)
        } else if (event.kind === 'usage-reported') {
          occupancyTokens =
            event.inputTokens + event.cacheReadInputTokens + event.cacheCreationInputTokens
        }
        await stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
      }
      await stream.writeSSE({ event: 'turn-stream-ended', data: '{}' })
    } finally {
      // Fires even on client disconnect (generator cleanup). Best-effort.
      activity.end()
      // An ask still parked when the turn ends (interrupt/disconnect — a
      // normal completion can't end with one open, the tool blocks the turn)
      // is unanswerable: cancel its waiter + expire its row so the UI never
      // shows a zombie wizard.
      const cancelledAskIds = c.var.askWaiters.cancelForTurn(askTurnKey)
      if (cancelledAskIds.length > 0) {
        try {
          const { expireAskRequests } = await import('@vynel/asks')
          expireAskRequests(c.var.db, { askIds: cancelledAskIds }, { logger: c.var.logger })
        } catch (err) {
          c.var.logger.warn({ err }, 'failed to expire cancelled asks after turn end')
        }
      }
      if (agentRunId) {
        try {
          await recordAgentRunCompleted(c.var.db, {
            runId: agentRunId,
            userId: c.var.user.id,
            workspaceId: c.var.workspace!.id,
            completedAt: new Date().toISOString(),
          })
        } catch (err) {
          c.var.logger.warn({ err }, 'failed to record agent.run-completed')
        }
      }

      // Primary-as-thread continuity at the turn boundary: link the primary to
      // the session this turn ran on, then seed-fresh swap if it crossed the
      // pressure threshold (so the NEXT turn runs on a fresh session). Awaited
      // before the stream closes so a swap is serialized ahead of the next turn;
      // on a non-pressured turn this is just a cheap link + pure pressure check,
      // no SDK call. Best-effort — a failure must never surface to the user.
      if (primaryTarget && effectiveSdkSessionId) {
        try {
          const model = findChatSessionById(c.var.db, effectiveSdkSessionId)?.model ?? null
          await applyPrimaryTurnContinuity(
            c.var.db,
            {
              primarySessionId: primaryTarget.primarySessionId,
              priorSdkSessionId: primaryTarget.resumeSdkSessionId,
              effectiveSdkSessionId,
              userId: c.var.user.id,
              workspaceId: c.var.workspace!.id,
              workspacePath: c.var.workspace!.path,
              providerId: DEFAULT_PROVIDER_ID,
              occupancyTokens,
              model,
              ...(pressureThreshold !== undefined ? { threshold: pressureThreshold } : {}),
            },
            { logger: c.var.logger },
          )
        } catch (err) {
          c.var.logger.warn({ err }, 'primary-as-thread continuity failed after turn')
        }
      }
    }
  })
}
