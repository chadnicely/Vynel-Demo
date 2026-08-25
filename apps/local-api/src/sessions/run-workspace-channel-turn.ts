// The WORKSPACE half of the channel pipeline: an inbound message on a channel
// BOUND to a workspace runs on THAT workspace's continuing conversation, not on
// the global root. Ch4 had routed every channel message to the global brain, so
// a Telegram bot pointed at a workspace answered from the wrong thread (Kafi,
// live 2026-08-21). Global channels keep `runGlobalRootTurn` untouched.
//
// The mechanics are a WORKSPACE SCHEDULE FIRE's, deliberately: take the
// workspace's single-writer key, resolve the continuing conversation INSIDE the
// lock, arm the cap only once the lock is held, announce on the feed with the
// workspace's own identity, drain `startChatTurn`. A busy workspace parks this
// turn FIFO behind the holder — never a second writer.
//
// What stays the CHANNEL pipeline's: the persisted user row is stamped with the
// origin channel ("via Telegram"), the reply marker rides PROVIDER input only,
// and the dispatcher is origin-wrapped so `reply_to_channel` answers the exact
// chat that asked (and a delegation this turn enqueues carries the same ids).
//
// TOOLSET: the same set the workspace's own interactive chat attaches
// (`streams/chat-turn.ts`) — a per-origin toolset would make the SDK strip
// `mcp__vynel*` off this shared primary and report the server offline (the
// 2026-07-21 bug `build-workspace-background-mcp.ts` documents). `ask_user`
// rides it BOUNDED (2026-08-22, closing agent A's deviation): the global
// channel runner has carried the same bound since the asks slice, and the
// situation is identical — nobody may be looking at the app, so an unanswered
// form expires and the turn proceeds on judgment instead of parking forever.
// The Telegram nudge needs no wiring: `consumeAskCreatedEvent` resolves the
// ask's own workspace channel first, which here is the channel that asked.

import { ApprovalWaitGate } from '@vynel/orchestration'
import { listEnabledCapabilities } from '@vynel/capabilities'
import {
  startChatTurn,
  composeSessionCapabilities,
  publishTurnActivityStep,
  resolvePrimaryConversationTarget,
  startTurnWallClock,
  trackApprovalParks,
  failTurnOnWallClock,
  type SessionActivityFeed,
  type TurnWallClockFailure,
} from '@vynel/session/runtime'
import { findPrimaryConversation } from '@vynel/session/continuity'
import {
  resolveBackgroundTurnSettings,
  type SessionTargetLocks,
  type TurnEventBroadcaster,
} from '@vynel/session/delegation'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import type { DelegationOrigin } from '@vynel/orchestration'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { HonoAppRequestFn } from '../factory.js'
import type { PendingAskRegistry } from '@vynel/asks'
import { composeSessionMcpServers } from './compose-session-mcp-servers.js'
import { resolveSessionToolPolicies } from './session-tool-catalog.js'
import { createTurnSessionCarrier } from './turn-session-header.js'
import type { ReadEnabledFeatureKeys } from './enabled-feature-keys.js'
import {
  wrapAppRequestWithOrigin,
  TurnWallClockExceededError,
  CHANNEL_ASK_TIMEOUT_MS,
} from './run-global-root-turn.js'
import { wrapAppRequestWithMode } from './delegation-mode-header.js'
import { loadEnv } from '../env.js'

export interface WorkspaceChannelTurnOptions {
  logger: Logger
  /** The in-process dispatcher this turn's MCP server re-enters the api through. */
  appRequest: HonoAppRequestFn
  /** The shared turn-liveness registry — a channel turn is invisible otherwise. */
  activityFeed: SessionActivityFeed
  /** The process-wide single-writer lock per target, SHARED with the delegation
   *  pool, the schedules fire path and the session-turn route — a private
   *  registry would serialize channel turns only among themselves. */
  targetLocks: SessionTargetLocks
  /** The shared live-turn pub/sub — the turn tees onto its session channel. */
  turnEvents?: TurnEventBroadcaster
  /** Per-composition entitlement read (tier filtering). Absent = fail-open. */
  readEnabledFeatureKeys?: ReadEnabledFeatureKeys
  /** The process-wide parked-ask registry — attaching it gives this turn
   *  `ask_user` with the bounded wait, the global channel runner's shape.
   *  Absent (tests, older wiring) = ask-free turn. */
  askWaiters?: PendingAskRegistry
  /** The turn's WORKING-time budget (ms). Omit = `VYNEL_INTERACTIVE_TURN_MAX_MS`,
   *  the same interactive knob a global channel turn wears (BT4). */
  hardCapMs?: number
}

export interface WorkspaceChannelTurnInput {
  userId: string
  workspaceId: string
  workspacePath: string
  /** The workspace name — renders the manager identity's {{workspace_name}}. */
  workspaceName: string
  userMessageText: string
  /** The channel coordinates this turn must answer — stamped on every request
   *  its tools make, so `reply_to_channel` needs no address from the model. */
  origin: DelegationOrigin
  /** Stamped on the persisted user row ("via Telegram"). */
  originChannel: 'telegram' | 'discord' | 'zoom'
  /** The per-message reply instruction — PROVIDER input only. */
  channelReplyMarker?: string
  /** Surface-up: a card this turn raised, pushed back to the sender. */
  onApprovalRequested?: (approval: {
    approvalRequestId: string
    toolName: string
    toolInput: unknown
  }) => void
}

export type RunWorkspaceChannelTurn = (
  db: Database,
  input: WorkspaceChannelTurnInput,
) => Promise<{ resultText: string }>

export async function buildWorkspaceChannelTurnRunner(
  options: WorkspaceChannelTurnOptions,
): Promise<RunWorkspaceChannelTurn> {
  const { logger, activityFeed, targetLocks, turnEvents, readEnabledFeatureKeys } = options
  const env = loadEnv()
  const hardCapMs = options.hardCapMs ?? env.VYNEL_INTERACTIVE_TURN_MAX_MS
  // The threshold every continuity consumer honors, so "fits" and "will swap"
  // never disagree on this turn either.
  const swapThreshold = env.VYNEL_CONTEXT_PRESSURE_THRESHOLD
  // Imported ONCE at build (the background-composer precedent) — the descriptors
  // pull the SDK builder + the generated registry.
  const { vynelWorkspaceInteractiveDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  const { buildSessionFeatureDescriptor } = await import('@vynel/session/mcp')
  const sessionFeatureDescriptor = buildSessionFeatureDescriptor(
    swapThreshold !== undefined ? { swapThreshold } : {},
  )
  const askWaiters = options.askWaiters
  const buildAskFeatureDescriptor =
    askWaiters !== undefined
      ? (await import('@vynel/asks/mcp')).buildAskFeatureDescriptor
      : undefined

  return async function runWorkspaceChannelTurn(db, input) {
    const { userId, workspaceId } = input
    // The workspace's single-writer key — the SAME one a delegated job, a
    // schedule fire and the chat stream's continue-mode turn take, so a channel
    // message can never interleave with a user turn on this conversation.
    const releaseLock = await targetLocks.acquire(workspaceId)
    try {
      // Resolved INSIDE the lock: the holder we queued behind may have
      // pressure-swapped the primary onto a fresh segment, and this turn must
      // resume THAT head. A workspace with no conversation yet registers its
      // primary here and this turn BECOMES the conversation.
      const target = await resolvePrimaryConversationTarget(db, { userId, workspaceId })
      // The turn's settings: what the user chose for this workspace's
      // continuing conversation (its head row), fit-clamped because the turn
      // RESUMES that head — a small-model pick over a fat chain would die with
      // "Prompt is too long" and nobody is watching an error row on Telegram.
      const settings = resolveBackgroundTurnSettings(db, {
        headSdkSessionId:
          findPrimaryConversation(db, { userId, workspaceId })?.currentSdkSessionId ?? null,
        job: { permissionMode: null, model: null, thinkingEffort: null },
        ...(swapThreshold !== undefined ? { threshold: swapThreshold } : {}),
        logger,
      })
      // Origin first (so `reply_to_channel` is addressed), then the resolved
      // mode (so any delegation this turn enqueues inherits it) — the
      // global-root runner's wrapping order.
      const appRequest = wrapAppRequestWithMode(
        wrapAppRequestWithOrigin(options.appRequest, input.origin),
        settings.permissionMode,
      )
      // Read the entitlement PER TURN — the hub session refreshes while the
      // process runs; absent reader/entitlement = fail-open (no tier filter).
      const enabledFeatureKeys = readEnabledFeatureKeys?.()
      // ONE gate per turn (the streams' rule): parked cards (the tracker below)
      // and parked asks (the descriptor) both mark it, and the wall clock
      // measures only what is left. Built BEFORE the composition — the ask
      // descriptor takes it.
      const waitGate = new ApprovalWaitGate()
      const askTurnKey = crypto.randomUUID()
      const askFeatureDescriptors =
        buildAskFeatureDescriptor !== undefined && askWaiters !== undefined
          ? [
              buildAskFeatureDescriptor({
                waiters: askWaiters,
                turnKey: askTurnKey,
                timeoutMs: CHANNEL_ASK_TIMEOUT_MS,
                waitGate,
                logger,
              }),
            ]
          : []
      // This turn's chat-session identity, filled by the stream's first frame —
      // the read half is what lets `ask_user` name the conversation it parked,
      // and what `whoami` / `set_session_status` / `set_task_steps` resolve against.
      const turnSession = createTurnSessionCarrier()
      const composedMcp = composeSessionMcpServers(
        [
          vynelWorkspaceInteractiveDescriptor,
          notebookFeatureDescriptor,
          sessionFeatureDescriptor,
          ...askFeatureDescriptors,
        ],
        {
          db,
          userId,
          workspaceId,
          appRequest,
          sessionId: target.primarySessionId,
          resolveChatSessionId: turnSession.current,
        },
        {
          enabledCapabilityIds: new Set(
            listEnabledCapabilities(db, workspaceId).map((capability) => capability.id),
          ),
          ...(enabledFeatureKeys !== undefined ? { enabledFeatureKeys } : {}),
          toolPolicies: resolveSessionToolPolicies(db, { userId }),
          surfaceKind: 'workspace-interactive',
        },
      )
      const composedCapabilities = composeSessionCapabilities(db, { workspaceId, workspaceName: input.workspaceName })

      // The cap arms only now the lock is HELD — queue time was the holder's
      // budget. A parked card suspends it; on expiry the streams' helper
      // interrupts the running session and the turn fails the typed way.
      const approvalParks = trackApprovalParks(waitGate)
      let runningSessionId: string | undefined = target.resumeSdkSessionId ?? undefined
      const cap: { failure: Promise<TurnWallClockFailure> | null } = { failure: null }
      const wallClock = startTurnWallClock({
        maxMs: hardCapMs,
        waitGate,
        logger,
        onExpire: async () => {
          logger.warn(
            { channelId: input.origin.channelId, workspaceId, hardCapMs },
            'channel turn: the workspace turn exceeded its cap — interrupting it',
          )
          cap.failure = failTurnOnWallClock(
            { db, logger },
            { sessionId: runningSessionId, maxMs: hardCapMs },
          )
          await cap.failure
        },
      })
      // The frame names the CONTINUING workspace identity beside the channel as
      // origin, so the app's rail opens the live thread the reply lands on.
      const activity = activityFeed.begin({
        userId,
        scopeKind: 'workspace',
        workspaceId,
        origin: input.originChannel,
        primarySessionId: target.primarySessionId,
        ...(target.resumeSdkSessionId !== null ? { sessionId: target.resumeSdkSessionId } : {}),
      })
      let turnOutcome: 'ended' | 'failed' = 'ended'
      let streamErrorMessage: string | null = null
      const resultTextChunks: string[] = []
      try {
        for await (const event of startChatTurn(
          db,
          {
            userId,
            workspaceId,
            workspacePath: input.workspacePath,
            providerId: DEFAULT_PROVIDER_ID,
            userMessageText: input.userMessageText,
            // The persisted row stays the clean inbound text; the model reads
            // the reply instruction appended (the voice-turn-marker seam).
            ...(input.channelReplyMarker !== undefined
              ? {
                  providerUserMessageText: `${input.userMessageText}\n\n${input.channelReplyMarker}`,
                }
              : {}),
            // HOW it arrived — the transcript's "via Telegram" origin.
            originChannel: input.originChannel,
            ...(target.resumeSdkSessionId !== null
              ? { resumeSessionId: target.resumeSdkSessionId }
              : {}),
            continuity: {
              primarySessionId: target.primarySessionId,
              ...(swapThreshold !== undefined ? { threshold: swapThreshold } : {}),
            },
            permissionMode: settings.permissionMode,
            ...(settings.model !== undefined ? { model: settings.model } : {}),
            ...(settings.thinkingEffort !== undefined
              ? { thinkingEffort: settings.thinkingEffort }
              : {}),
            ...(settings.autoBuildout ? { autoBuildout: true } : {}),
            mcpServers: composedMcp.mcpServers,
            deniedToolNames: composedMcp.deniedMcpToolPatterns,
            systemPromptAppend: [
              composedCapabilities.systemPromptAppend,
              composedMcp.systemPromptAppend,
            ]
              .filter((section) => section !== '')
              .join('\n\n'),
            ...(composedMcp.mutatingToolNames.length > 0
              ? { alwaysRequireApprovalToolNames: composedMcp.mutatingToolNames }
              : {}),
            ...(composedMcp.askModeApprovalToolNames.length > 0
              ? { askModeApprovalToolNames: composedMcp.askModeApprovalToolNames }
              : {}),
          },
          {
            logger,
            ...(turnEvents !== undefined ? { turnEvents } : {}),
          },
        )) {
          approvalParks.onTurnEvent(event)
          if (event.kind === 'session-created') {
            runningSessionId = event.session.id
            activity.sessionResolved(event.session.id)
            turnSession.resolve(event.session.id)
          } else if (event.kind === 'user-message-persisted') {
            runningSessionId = event.message.sessionId
            activity.sessionResolved(event.message.sessionId)
            turnSession.resolve(event.message.sessionId)
          } else if (event.kind === 'text-chunk') {
            resultTextChunks.push(event.textDelta)
          } else if (event.kind === 'approval-requested') {
            // Surface-up: the core already recorded the card (web notifier);
            // this hands it to the channel path so the sender is asked too.
            input.onApprovalRequested?.({
              approvalRequestId: event.approvalRequestId,
              toolName: event.toolName,
              toolInput: event.toolInput,
            })
          } else if (event.kind === 'session-errored') {
            streamErrorMessage = event.errorMessage
            if (!event.isRecoverable) turnOutcome = 'failed'
          }
          publishTurnActivityStep(activity, event)
        }
        // The cap is the honest outcome whatever the interrupted stream left.
        if (cap.failure !== null) throw new TurnWallClockExceededError(await cap.failure)
        if (streamErrorMessage !== null) {
          turnOutcome = 'failed'
          throw new Error(`the workspace channel turn errored: ${streamErrorMessage}`)
        }
      } catch (err) {
        turnOutcome = 'failed'
        if (cap.failure !== null && !(err instanceof TurnWallClockExceededError)) {
          throw new TurnWallClockExceededError(await cap.failure)
        }
        throw err
      } finally {
        wallClock.clear()
        activity.end(turnOutcome)
        // A parked ask must not outlive its turn (the global runner's cleanup,
        // mirrored): cancel THIS turn's waiters and expire their rows. GUARDED
        // — a bookkeeping failure here must never replace the turn's real
        // outcome; boot expiry sweeps any row this misses.
        if (askWaiters !== undefined) {
          try {
            const cancelledAskIds = askWaiters.cancelForTurn(askTurnKey)
            if (cancelledAskIds.length > 0) {
              const { expireAskRequests } = await import('@vynel/asks')
              expireAskRequests(db, { askIds: cancelledAskIds }, { logger })
            }
          } catch (err) {
            logger.warn({ err }, 'failed to expire cancelled ask requests at turn end')
          }
        }
      }
      return { resultText: resultTextChunks.join('').trim() }
    } finally {
      // EVERY exit passes through this release, or the workspace key leaks and
      // the delegation pool + every continue-turn on this workspace park forever.
      releaseLock()
    }
  }
}
