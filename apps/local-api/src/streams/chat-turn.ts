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
import type { SSEStreamingApi } from 'hono/streaming'
import {
  startChatTurn,
  composeSessionCapabilities,
  resolvePrimaryConversationTarget,
  publishTurnActivityStep,
} from '@vynel/session/runtime'
import {
  composeSessionAgents,
  recordAgentRunStarted,
  recordAgentRunCompleted,
} from '@vynel/orchestration'
import { listEnabledCapabilities } from '@vynel/capabilities'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import { toPermissionMode, DEFAULT_SESSION_MODE } from '@vynel/session'
import { findPrimaryConversation } from '@vynel/session/continuity'
import { resolveTurnSessionSettings, persistTurnSessionSettings } from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import type { AppEnv } from '../factory.js'
import { loadEnv } from '../env.js'
import { isPrimarySwapping } from '@vynel/session/continuity'
import { composeSessionMcpServers } from '../sessions/compose-session-mcp-servers.js'
import { createTurnSessionCarrier } from '../sessions/turn-session-header.js'
import { prepareComposerMentionTurn } from '../sessions/composer-mention-turn.js'
import { buildRecordDiscoveredModels } from '../sessions/build-record-discovered-models.js'
import { resolveEnabledFeatureKeys } from '../sessions/enabled-feature-keys.js'
import { resolveSessionToolPolicies } from '../sessions/session-tool-catalog.js'
import { writeSseSafely } from './write-sse-safely.js'
import type { z } from 'zod'
import type { StartChatTurnRequestSchema } from '../routes/chat/schemas.js'

type StartChatTurnInput = z.infer<typeof StartChatTurnRequestSchema>

export async function streamChatTurn(
  c: Context<AppEnv>,
  input: StartChatTurnInput,
): Promise<Response> {
  // Compose THIS chat session's MCP attachment. An INTERACTIVE workspace turn
  // gets the full route-derived `vynel` server PLUS the session-spawning tools
  // (Slice ④b — the interactive descriptor; background workspace turns compose
  // `vynelWorkspaceDescriptor` and never see them). Registration alone offers
  // the tools — each call gates through the provider's canUseTool policy map;
  // a disabled capability's tools are DENIED via the descriptor's
  // capabilityGatedTools + the enabled-capability set. The composer is the
  // single per-turn step for servers + deny; the system prompt still comes
  // from composeSessionCapabilities below (memory snapshot etc.).
  // Dynamic import keeps the heavy SDK out of module load.
  const { vynelWorkspaceInteractiveDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  // ask_user here waits UNBOUNDED — an interactive stream means the user is
  // present (docs/module-notes/ask.md fork #1). Channel turns attach it too,
  // but with a timeout (see runGlobalRootTurn).
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
  const enabledFeatureKeys = resolveEnabledFeatureKeys(c.var.hubSession)
  // The admin's per-tool overrides (no desktop on this surface → []).
  const toolPolicies = resolveSessionToolPolicies(c.var.db, { userId: c.var.user.id })
  // Per-session settings resolution: explicit input ?? the target session's
  // persisted setting ?? the surface default. The settings row is read
  // PRE-lock deliberately — settings are swap-stable (copied forward onto
  // fresh segments), so a pressure swap between here and the in-lock resume
  // resolution can't change the values; only the resume TARGET needs the lock.
  const settingsSessionId =
    input.resumeSessionId ??
    (input.continueRoot === true && c.var.workspace!.continueEnabled
      ? (findPrimaryConversation(c.var.db, {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
        })?.currentSdkSessionId ?? null)
      : null)
  const turnSettings = resolveTurnSessionSettings(
    input,
    settingsSessionId !== null ? findChatSessionById(c.var.db, settingsSessionId) : null,
  )
  // Chat-mentions: re-parse the message server-side — @/@Persona dispatches
  // (enqueued once the turn's session resolves) + the per-turn # study
  // descriptor. Never throws; null = a token-free turn.
  const turnPermissionMode = toPermissionMode(turnSettings.mode ?? DEFAULT_SESSION_MODE)
  const mentionPlan = await prepareComposerMentionTurn(
    c.var.db,
    {
      userId: c.var.user.id,
      userMessageText: input.userMessageText,
      originWorkspaceId: c.var.workspace!.id,
      originWorkspacePath: c.var.workspace!.path,
      permissionMode: turnPermissionMode,
      ...(turnSettings.model !== undefined ? { model: turnSettings.model } : {}),
      ...(turnSettings.thinkingEffort !== undefined
        ? { thinkingEffort: turnSettings.thinkingEffort }
        : {}),
    },
    { logger: c.var.logger },
  )
  // Primary-as-thread (Slice 1) + continue-mode activation (Slice 2): when the
  // turn runs on the workspace's continuing PRIMARY conversation AND the
  // workspace has continue-mode enabled, the active conversation follows the
  // primary (a swap underneath stays invisible). continueEnabled is the
  // per-workspace off-switch — when off, a `continueRoot` request is ignored
  // and this is a normal session turn. Any non-primary turn (resume by id, or
  // new) is byte-for-byte today's behavior.
  const isContinueActive = input.continueRoot === true && c.var.workspace!.continueEnabled
  // The workspace's STABLE identity, resolved BEFORE composition so the turn's
  // tools know who they are (whoami keys on it) — idempotent get-or-create;
  // the in-lock re-resolve below stays authoritative for the session to resume.
  const continuingPrimaryId = isContinueActive
    ? (
        await resolvePrimaryConversationTarget(c.var.db, {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
        })
      ).primarySessionId
    : null
  // Dev/test swap-trigger override (Slice 2 live UI smoke); unset → production 0.85.
  const pressureThreshold = loadEnv().VYNEL_CONTEXT_PRESSURE_THRESHOLD
  // whoami — built with the swap threshold in force so what it reports matches
  // what the boundary op will do.
  const { buildSessionFeatureDescriptor } = await import('@vynel/session/mcp')
  const sessionFeatureDescriptor = buildSessionFeatureDescriptor(
    pressureThreshold !== undefined ? { swapThreshold: pressureThreshold } : {},
  )
  // The turn's own session identity, stamped onto every request its tools make
  // (`set_todos` writes the dock of exactly this session). Created BEFORE
  // composition and resolved below/from the stream — a fresh conversation has
  // no id yet at this point.
  const turnSession = createTurnSessionCarrier()
  const composedMcp = composeSessionMcpServers(
    [
      vynelWorkspaceInteractiveDescriptor,
      notebookFeatureDescriptor,
      sessionFeatureDescriptor,
      askFeatureDescriptor,
      ...sshFeatureDescriptors,
      ...(mentionPlan?.studyDescriptor ? [mentionPlan.studyDescriptor] : []),
    ],
    {
      db: c.var.db,
      userId: c.var.user.id,
      workspaceId: c.var.workspace!.id,
      // The continuing identity, when this turn IS the workspace's primary
      // conversation — a plain session (by id / fresh) has none and says so.
      ...(continuingPrimaryId !== null ? { sessionId: continuingPrimaryId } : {}),
      // The same carrier read lazily — a tool that RECORDS this conversation
      // (an ask row) needs the id a fresh chat only learns mid-stream.
      resolveChatSessionId: turnSession.current,
      appRequest: turnSession.wrapAppRequest(c.var.appRequest),
    },
    {
      enabledCapabilityIds,
      ...(enabledFeatureKeys !== undefined ? { enabledFeatureKeys } : {}),
      toolPolicies,
      surfaceKind: 'workspace-interactive',
    },
  )

  const locks = c.var.sessionTargetLocks
  const workspaceId = c.var.workspace!.id

  const runTurn = async (stream: SSEStreamingApi): Promise<void> => {
    // Resolved INSIDE the target lock (single-writer wrapper below): the
    // delegated run we may have queued behind can pressure-swap the primary
    // onto a fresh segment — the turn must resume THAT head, never a pre-wait
    // read (the session-turn.ts recipe).
    const primaryTarget = isContinueActive
      ? await resolvePrimaryConversationTarget(c.var.db, {
          userId: c.var.user.id,
          workspaceId,
        })
      : null
    const resumeSessionId = primaryTarget
      ? (primaryTarget.resumeSdkSessionId ?? undefined)
      : input.resumeSessionId
    // A resumed turn knows its session before the first frame — stamp it now so
    // even a tool called on the very first event carries the identity.
    if (resumeSessionId !== undefined) turnSession.resolve(resumeSessionId)
    const composed = composeSessionCapabilities(c.var.db, { workspaceId: c.var.workspace!.id })
    // Compose the enabled agents for this session (Mode A — the root model
    // delegates to them via the SDK Agent tool). In ask mode every
    // irreversible (sub)agent tool call still cards via the always-on
    // PreToolUse backstop; in auto/bypass the user's mode covers the whole
    // turn, subagents included (2026-07-30 stance).
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
    // The SDK session the turn actually ran on — names the error frame's
    // session on a mid-stream failure (a NEW session's id is only known at
    // session-created). Continuity itself rides the stream (the `continuity`
    // input on startChatTurn below), so nothing else here tracks it.
    let effectiveSdkSessionId: string | null = resumeSessionId ?? null
    // Settings write-through, once per turn at session resolve: what the
    // composer sent becomes the row's persisted truth (a fresh conversation's
    // first turn stamps the row it just created). Input-only — omitted fields
    // stay "never set". Best-effort inside the helper.
    let settingsPersisted = false
    const persistSettingsOnce = (sessionId: string): void => {
      if (settingsPersisted) return
      settingsPersisted = true
      persistTurnSessionSettings(c.var.db, sessionId, input, { logger: c.var.logger })
    }

    const turnStream = startChatTurn(
      c.var.db,
      {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        workspacePath: c.var.workspace!.path,
        providerId: DEFAULT_PROVIDER_ID,
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        // The continuing identity: the boundary continuity step rides the
        // stream (link → measure → `context-patching` / swap / `context-patched`
        // at pressure), inside the session-channel tee. A plain session (by
        // id / fresh) passes none and neither swaps nor carries context.
        ...(primaryTarget !== null
          ? {
              continuity: {
                primarySessionId: primaryTarget.primarySessionId,
                ...(pressureThreshold !== undefined ? { threshold: pressureThreshold } : {}),
              },
            }
          : {}),
        userMessageText: input.userMessageText,
        ...(input.attachedImages !== undefined ? { attachedImages: input.attachedImages } : {}),
        ...(turnSettings.model !== undefined ? { model: turnSettings.model } : {}),
        ...(turnSettings.thinkingEffort !== undefined
          ? { thinkingEffort: turnSettings.thinkingEffort }
          : {}),
        // Map the user-facing session mode → provider permission mode, after
        // the per-session settings resolution above (explicit input ?? the
        // session's persisted setting ?? DEFAULT_SESSION_MODE). The mode is
        // the user's trust level for the whole turn: ask cards the floor,
        // auto defers to the classifier, bypass never asks (2026-07-30 stance).
        permissionMode: turnPermissionMode,
        mcpServers: composedMcp.mcpServers,
        // Deny a disabled capability's tools (from the composer); the system prompt
        // joins composeSessionCapabilities (Vynel operating-rules + memory snapshot
        // etc.) with the MCP composer's per-feature prompt sections (notebook /
        // tasks / ask standing lines). The MCP half used to be dropped here — a
        // silent divergence from the global-root stream (found in the ask build;
        // the notebook's standing line never reached workspace turns).
        deniedToolNames: composedMcp.deniedMcpToolPatterns,
        systemPromptAppend: [
          composed.systemPromptAppend,
          composedMcp.systemPromptAppend,
          // The mention-dispatch note (chat-mentions) — the model must know
          // the mentioned work is already running.
          mentionPlan?.systemPromptAppend ?? '',
        ]
          .filter((section) => section !== '')
          .join('\n\n'),
        // A feature's declared mutating tools card even under bypass (additive to
        // the provider's static floor).
        ...(composedMcp.mutatingToolNames.length > 0
          ? { alwaysRequireApprovalToolNames: composedMcp.mutatingToolNames }
          : {}),
        ...(composedMcp.askModeApprovalToolNames.length > 0
          ? { askModeApprovalToolNames: composedMcp.askModeApprovalToolNames }
          : {}),
        // Only attach when the workspace has enabled agents — keep the SDK
        // options clean for the common no-agents turn.
        ...(Object.keys(sessionAgents).length > 0 ? { agents: sessionAgents } : {}),
        // Persist the roster the engine reports — feeds the model picker.
        onModelsDiscovered: buildRecordDiscoveredModels(c.var.db, c.var.user.id, c.var.logger),
      },
      // turnEvents: the turn tees onto its session channel (Watch everywhere).
      { logger: c.var.logger, turnEvents: c.var.turnEvents },
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
    // 'failed' when the drain sees a terminal session-errored or throws — the
    // durable envelope + feed carry it (the status vocabulary's problem signal).
    let turnOutcome: 'ended' | 'failed' = 'ended'
    try {
      for await (const event of turnStream) {
        if (event.kind === 'session-errored' && !event.isRecoverable) turnOutcome = 'failed'
        // Track the session the turn ran on (a NEW session's id is only known
        // at session-created).
        if (event.kind === 'session-created') {
          effectiveSdkSessionId = event.session.id
          activity.sessionResolved(event.session.id)
          turnSession.resolve(event.session.id)
          mentionPlan?.onSessionResolved(event.session.id)
          persistSettingsOnce(event.session.id)
        } else if (event.kind === 'user-message-persisted') {
          // A resumed turn never emits session-created — this is its identity.
          activity.sessionResolved(event.message.sessionId)
          turnSession.resolve(event.message.sessionId)
          mentionPlan?.onSessionResolved(event.message.sessionId)
          persistSettingsOnce(event.message.sessionId)
        }
        // Narrate tool steps + approval bells on the feed (other surfaces —
        // the desktop overlay, the activity panel — see them live).
        publishTurnActivityStep(activity, event)
        await stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
      }
    } catch (err) {
      // A mid-stream throw (consumer/DB) must still reach the client as typed
      // frames — a bare socket close leaves the composer "working" forever.
      turnOutcome = 'failed'
      c.var.logger.error({ err }, 'chat turn stream failed mid-flight')
      await writeSseSafely(
        stream,
        'session-errored',
        JSON.stringify({
          kind: 'session-errored',
          sessionId: effectiveSdkSessionId ?? '',
          errorCode: 'turn-stream-failed',
          errorMessage: err instanceof Error ? err.message : String(err),
          isRecoverable: false,
        }),
        c.var.logger,
      )
    } finally {
      // The terminal frame fires on EVERY exit — clean drain, thrown failure,
      // or disconnect (where the write no-ops).
      await writeSseSafely(stream, 'turn-stream-ended', '{}', c.var.logger)
      // Fires even on client disconnect (generator cleanup). Best-effort.
      activity.end(turnOutcome)
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
    }
  }

  return streamSSE(c, async (stream) => {
    // Single-writer on the workspace primary (B3): a continue-mode turn resumes
    // the SAME SDK session the delegation pool's workspace runs resume, so it
    // acquires the pool's exact exclusion key — the workspace id — and
    // FIFO-queues behind a running delegated task (or a second tab) instead of
    // interleaving two writers on one CLI session (root-turn-lock's documented
    // failure mode, workspace-side). The queued sentinel goes out BEFORE
    // parking (the session-turn.ts shape) so the composer can tell waiting from
    // frozen. Non-primary turns (resume-by-id, new session) target sessions the
    // pool never writes — no lock, byte-for-byte prior behavior.
    if (!isContinueActive) {
      await runTurn(stream)
      return
    }
    if (locks.isBusy(workspaceId)) {
      // WHY it waits: behind this workspace's own context swap (the composer
      // says "patching context") or behind a running task ("working on a task").
      const reason =
        continuingPrimaryId !== null && isPrimarySwapping(continuingPrimaryId)
          ? 'context-patching'
          : 'busy'
      await stream.writeSSE({ event: 'turn-queued', data: JSON.stringify({ reason }) })
    }
    const releaseTargetLock = await locks.acquire(workspaceId)
    try {
      await runTurn(stream)
    } finally {
      // Every exit — clean drain, a composition throw, a client disconnect —
      // MUST pass through this release, or the workspace key leaks and both the
      // delegation pool and every future continue-turn park on this workspace
      // forever (the session-turn.ts pin).
      releaseTargetLock()
    }
  })
}
