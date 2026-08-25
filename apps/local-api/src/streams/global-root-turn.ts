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
// Session-hardening (2026-08-19): a VOICE turn (`input.voice`) runs the voice
// tier forced over the body (D2), attaches no ask_user (the model asks in
// speech), never auto-continues (the daemon leaves at the first completion),
// and announces itself as `scopeKind: 'voice'` with its own primary id (the
// identity-shaped feed); the resolved mode is stamped on every routing request
// unconditionally; the turn is bounded by the interactive wall clock (D5).
//
// Voice-realtime (2026-08-19, VR1): a voice turn also loses the `speak` tool —
// its streamed TEXT is what the user hears, so the tool would say the answer a
// second time a round-trip late. The rule and its WHY live in
// `sessions/voice-thread-tools.ts`; this file only declares that the turn is
// spoken.
//
// The VOICE CLIENT CONTRACT (barge-in), stated here because three clients
// depend on it. A voice client SPEAKS this stream's `text-chunk` deltas as they
// arrive, so it needs the turn's session id BEFORE the first chunk in order to
// cut a running turn off when the user talks over it. Guaranteed frame order:
//   - resumed turn (the normal shape) — `user-message-persisted` is written
//     first, before the provider is even started; take `message.sessionId`.
//   - first-ever turn / a fresh segment after a swap — `session-created`
//     carries `session.id`.
//   - a mid-turn compaction swap re-issues both on the new segment; always
//     keep the LATEST id seen, never the first.
// Barge-in = `POST /root/turn/interrupt { sessionId }` with that id — the CHAT
// session id (the segment), NOT the primary — then run the new utterance as a
// new turn. NEVER send the id-less form of that route from a voice client: it
// falls back to the GLOBAL primary's head and would stop the wrong thread. The
// `turn-queued` sentinel below is emitted while the turn waits for the lock and
// carries no id — a barge-in in that window aborts the local stream only (which
// now also drops the queued waiter, audit R2-J).

import type { Context } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { Logger } from 'pino'
import type { ChatTurnEvent } from '@vynel/chat'
import { persistTurnSessionSettings } from '@vynel/chat'
import {
  ApprovalWaitGate,
  composeSessionAgents,
  recordAgentRunStarted,
  recordAgentRunCompleted,
} from '@vynel/orchestration'
import { defaultEnabledCapabilityIds } from '@vynel/capabilities'
import {
  runGlobalRootTurnCore,
  publishTurnActivityStep,
  startTurnWallClock,
  trackApprovalParks,
  failTurnOnWallClock,
  LockWaitAbandonedError,
  type SessionSink,
  type SessionTurnActivityHandle,
  type TurnWallClock,
} from '@vynel/session/runtime'
import type { McpFeatureDescriptor } from '@vynel/mcp-contract'
import type { AppEnv } from '../factory.js'
import { composeSessionMcpServers } from '../sessions/compose-session-mcp-servers.js'
import { withVoiceThreadToolDenials } from '../sessions/voice-thread-tools.js'
import { createTurnSessionCarrier } from '../sessions/turn-session-header.js'
import { prepareComposerMentionTurn } from '../sessions/composer-mention-turn.js'
import { buildRecordDiscoveredModels } from '../sessions/build-record-discovered-models.js'
import { buildRecordRateLimitSnapshot } from '../sessions/build-record-rate-limit-snapshot.js'
import { writeSseSafely } from './write-sse-safely.js'
import { buildTurnLockWait, requestAbortSignal, writeLockWaitGiveUp } from './turn-queue-wait.js'
import { resolveInteractiveTurnSettings } from './interactive-turn-settings.js'
import { loadEnv, resolveLockWaitMaxMs } from '../env.js'
import { resolveDesktopActionsEnabled } from '../sessions/resolve-desktop-actions-enabled.js'
import { isPrimarySwapping } from '@vynel/session/continuity'
import {
  resolveGlobalRootConversationTarget,
  resolveVoiceConversationTarget,
} from '../sessions/resolve-global-root-conversation.js'
import { ensureGlobalRootWorkspaceDir } from '../sessions/global-root-workspace.js'
import { wrapAppRequestWithMode } from '../sessions/delegation-mode-header.js'
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
    /** Sees every event before it is written — the wall clock's approval
     *  park tracker rides here (a parked card suspends the clock). */
    private readonly onTurnEvent?: (event: ChatTurnEvent) => void,
  ) {}

  async onEvent(event: ChatTurnEvent): Promise<void> {
    if (event.kind === 'session-errored' && !event.isRecoverable) this.turnOutcome = 'failed'
    this.onTurnEvent?.(event)
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
    // A turn that gave up in the LOCK QUEUE never started — it is not a stream
    // failure, and the client gets the honest "the conversation stayed busy"
    // frame instead of a raw crash message (audit R2-J). A waiter dropped
    // because its client disconnected writes nothing: nobody is reading.
    const gaveUpQueued = await writeLockWaitGiveUp(this.stream, err, {
      sessionId: null,
      logger: this.logger,
    })
    // The outcome is set INSIDE the branch, not above it: a give-up is not a
    // failed turn, it is a turn that never ran. Marked before the branch, a
    // user closing a tab while queued left a durable `turn-ended failed` on the
    // feed — a problem signal for a turn nobody ever started. The workspace
    // streams cannot hit this at all (they begin their handle AFTER the
    // acquire, so a give-up records nothing there either).
    if (!gaveUpQueued && !(err instanceof LockWaitAbandonedError)) {
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
    }
    // The error path must still end the stream with the terminal frame, or the
    // client folds the error and then waits on a close that reads as clean.
    await writeSseSafely(this.stream, 'turn-stream-ended', '{}', this.logger)
  }
}

export async function streamGlobalRootTurn(
  c: Context<AppEnv>,
  input: StartGlobalRootTurnInput,
): Promise<Response> {
  // A VOICE turn runs on the SPOKEN TWIN thread — its own continuing session
  // (scope 'voice'), never the global conversation (voice-session arc): the
  // two areas share ground and toolset but not a context window, so a large
  // global brain can no longer break speech (the 2026-08-19 incident).
  const isVoiceTurn = input.voice === true
  const resolveConversationTarget = () =>
    isVoiceTurn
      ? resolveVoiceConversationTarget(c.var.db, { userId: c.var.user.id })
      : resolveGlobalRootConversationTarget(c.var.db, { userId: c.var.user.id })
  // The thread's STABLE identity, resolved pre-lock so the desktop action
  // record can key its rows by it (the SDK id is only assigned mid-stream).
  // The get-or-create is idempotent + partial-unique race-safe, so this early
  // call cannot fight the authoritative in-lock `resolveTarget`.
  // Also the settings row: the thread's CURRENT segment carries the user's
  // persisted composer settings (swap-stable — copied forward onto fresh
  // segments), so the pre-lock read resolves the same values as the head.
  const conversationTarget = await resolveConversationTarget()
  const env = loadEnv()
  const pressureThreshold = env.VYNEL_CONTEXT_PRESSURE_THRESHOLD
  // Settings (one home: `resolveInteractiveTurnSettings`). A KEYBOARD turn:
  // input ?? the thread's persisted row ?? the default. A VOICE turn is a
  // surface with PINNED parameters, not the user's chips (D2): the voice tier
  // — sonnet-5 / low / auto — forced over whatever the body carries, the row
  // neither read nor written (the write-through below is gated the same way),
  // and the pin fit-clamped against the head it resumes so a large brain can
  // never break speech (the 2026-08-19 incident).
  const turnSettings = resolveInteractiveTurnSettings(
    c.var.db,
    input,
    {
      sessionId: conversationTarget.resumeSdkSessionId,
      ...(pressureThreshold !== undefined ? { pressureThreshold } : {}),
    },
    { logger: c.var.logger },
  )
  // The turn's RESOLVED permission mode (surface-up step 1): governs the brain's
  // own tools AND rides the mode header on every routing request — stamped
  // unconditionally, the default included, so a delegation this turn enqueues
  // runs the mode its parent ran (parent == child, audit A6). Voice: the tier's
  // `auto` — no Vynel card of any kind on a hands-free surface (D1).
  const permissionMode = turnSettings.permissionMode
  const modeAwareAppRequest = wrapAppRequestWithMode(c.var.appRequest, permissionMode)
  // The turn's own session identity (`set_session_status` sets the light of exactly
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
  // whoami — every session knows who it is; built with the swap threshold in
  // force so what it reports matches what the boundary op will do.
  const { buildSessionFeatureDescriptor } = await import('@vynel/session/mcp')
  const sessionFeatureDescriptor = buildSessionFeatureDescriptor(
    pressureThreshold !== undefined ? { swapThreshold: pressureThreshold } : {},
  )
  // ONE gate per turn: parked cards (the sink) and parked asks (the bridge)
  // both mark it; the wall clock measures only what is left.
  const waitGate = new ApprovalWaitGate()
  // ask_user rides KEYBOARD turns only, with the generous interactive bound
  // (D5: `VYNEL_INTERACTIVE_ASK_MAX_MS`, 2 h — the user is present, so a
  // decision Claude chose to ask for is never fabricated quickly, but a form
  // the user walked away from must not wedge the `${userId}` root lock — and
  // with it channels + deliveries — for the process lifetime; audit G1). The
  // background channel runner (`runGlobalRootTurn`) attaches it with its short
  // bound. NEVER on a VOICE turn: a form nobody can see on a hands-free
  // surface parked the spoken thread until restart — the model asks in speech
  // and the next utterance is the answer.
  const { buildAskFeatureDescriptor } = await import('@vynel/asks/mcp')
  // This turn's key — turn-end cleanup cancels exactly the asks THIS turn parked.
  const askTurnKey = crypto.randomUUID()
  const askFeatureDescriptors: McpFeatureDescriptor[] = isVoiceTurn
    ? []
    : [
        buildAskFeatureDescriptor({
          waiters: c.var.askWaiters,
          turnKey: askTurnKey,
          timeoutMs: env.VYNEL_INTERACTIVE_ASK_MAX_MS,
          waitGate,
          logger: c.var.logger,
        }),
      ]
  // The ssh tools ride interactive streams only (module notes) and need the
  // sealing master key — no key resolved at boot means the sealed credentials
  // are unopenable, so the tools would only error: attach nothing instead.
  // Fail-closed on the TYPE too (a partial test harness leaves the var unset).
  const { buildSshFeatureDescriptor } = await import('@vynel/ssh-servers/mcp')
  const sealingMasterKey = c.var.sealingMasterKey
  const sshFeatureDescriptors =
    typeof sealingMasterKey === 'string'
      ? [buildSshFeatureDescriptor({ masterKeyBase64: sealingMasterKey, logger: c.var.logger })]
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
      permissionMode,
      // The RESOLVED model — a voice turn's fitted tier, never an unfitted pin
      // (the turn and its dispatches run the same model).
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
  const composedRoutingMcp = composeSessionMcpServers(
    [
      vynelRoutingDescriptor,
      notebookFeatureDescriptor,
      sessionFeatureDescriptor,
      ...askFeatureDescriptors,
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
      // Resolved PER TURN (Settings → Desktop control), so flipping the
      // toggle takes effect on the next turn with no restart.
      enableDesktopActions: resolveDesktopActionsEnabled(c.var.db, c.var.user.id),
      // Plan-level approval: the turn's mode decides what an approved desktop
      // plan may authorize (ask = the card; auto/bypass = standing consent).
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
  // The spoken thread's own rule, on top of the composed gates (VR1): this
  // turn's text IS its voice, so `speak` is denied for it and left untouched
  // for every keyboard/channel/schedule turn.
  const composedMcp = isVoiceTurn
    ? withVoiceThreadToolDenials(composedRoutingMcp)
    : composedRoutingMcp

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
    // IDENTITY-shaped: the spoken thread is its OWN scope kind and every turn
    // carries its primary id, so no reader infers who is running from an
    // absence (a voice turn announcing as `global` with no primary let the
    // Global chat bind to the spoken segment — audit V2).
    const activity = c.var.activityFeed.begin({
      userId: c.var.user.id,
      scopeKind: isVoiceTurn ? 'voice' : 'global',
      primarySessionId: conversationTarget.primarySessionId,
      origin: isVoiceTurn ? 'voice' : 'web',
    })
    // Parked cards suspend the wall clock; the sink feeds the tracker every event.
    const approvalParks = trackApprovalParks(waitGate)
    // Hoisted so the finally can end the feed with the DURABLE outcome — a
    // terminal session-errored records 'failed' on the turn envelope (Move 3
    // feeder fix; the workspace streams' `turnOutcome` rule).
    const sink = new GlobalRootSseSink(
      stream,
      c.var.logger,
      activity,
      (sdkSessionId) => {
        turnSession.resolve(sdkSessionId)
        mentionPlan?.onSessionResolved(sdkSessionId)
        // Settings write-through onto the resolved segment: what the composer
        // sent becomes the row's persisted truth. Input-only — omitted fields
        // stay "never set" — and NEVER for a voice turn: the tier's pins are
        // the surface's, not the user's chips (the voice-clobber review
        // finding). Idempotent downstream like the other two callbacks.
        if (!isVoiceTurn) {
          persistTurnSessionSettings(c.var.db, sdkSessionId, input, { logger: c.var.logger })
        }
      },
      approvalParks.onTurnEvent,
    )
    // The interactive wall clock (D5) — armed by `resolveTarget` below, the
    // core's FIRST in-lock call, so it measures the time this turn HOLDS its
    // root lock (a turn queued behind another spends the holder's budget, not
    // its own); suspended while a card or an ask is parked (the shared gate);
    // cleared in the finally. Expiry: the honest failure row + an interrupt of
    // the head the turn is on, so the provider ends the stream and the lock
    // releases through the core's chain. A ref, not a `let`: the arm happens
    // inside the core's callback and the finally must still see it.
    const wallClock: { current: TurnWallClock | null } = { current: null }
    const armWallClock = (): void => {
      wallClock.current ??= startTurnWallClock({
        maxMs: env.VYNEL_INTERACTIVE_TURN_MAX_MS,
        waitGate,
        logger: c.var.logger,
        onExpire: async () => {
          sink.turnOutcome = 'failed'
          const failure = await failTurnOnWallClock(
            { db: c.var.db, logger: c.var.logger },
            { sessionId: turnSession.current(), maxMs: env.VYNEL_INTERACTIVE_TURN_MAX_MS },
          )
          await writeSseSafely(
            stream,
            'session-errored',
            JSON.stringify({
              kind: 'session-errored',
              sessionId: turnSession.current() ?? '',
              ...failure,
              isRecoverable: false,
            }),
            c.var.logger,
          )
        },
      })
    }
    // A turn arriving while another turn holds this identity's root lock (a
    // second window, a channel turn, the thread's own context swap) parks
    // inside the core. The queued sentinel, the queue's bound and its cancel
    // are ONE home now (audit R2-J): the lock announces WHY the moment this
    // turn parks, keeps re-announcing while it waits, gives up past the budget
    // and drops the waiter when the client goes away. Background callers of
    // the same core (channels, a global schedule fire, a delivery notify turn)
    // pass no `lockWait` and keep their unbounded FIFO wait.
    const lockWait = buildTurnLockWait({
      stream,
      requestSignal: requestAbortSignal(c),
      maxWaitMs: resolveLockWaitMaxMs(env),
      resolveReason: () =>
        isPrimarySwapping(conversationTarget.primarySessionId) ? 'context-patching' : 'busy',
      logger: c.var.logger,
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
          // Called again per automatic continuation; the clock arms once.
          resolveTarget: async () => {
            armWallClock()
            const target = await resolveConversationTarget()
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
          permissionMode,
          // Autopilot (D8) — the resolved Auto-buildout rides the turn; the
          // core appends the marker when true (never on voice — no chips).
          ...(turnSettings.autoBuildout !== undefined
            ? { autoBuildout: turnSettings.autoBuildout }
            : {}),
          // A voice turn also RECORDS its origin — the transcript shows "via
          // Voice" — and never auto-continues: the daemon returns at the first
          // completion, so continuations would run unheard holding the voice
          // lock while the daemon says "listening" (audit V5).
          ...(isVoiceTurn
            ? { voice: true, originChannel: 'voice' as const, autoContinue: false }
            : {}),
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
          // Persist the account's limit readings — feeds the popup's Limits tab.
          onRateLimitReported: buildRecordRateLimitSnapshot(c.var.db, c.var.user.id, c.var.logger),
          // Dev/test swap-trigger override (the live smoke's knob); unset → 0.85.
          ...(pressureThreshold !== undefined ? { pressureThreshold } : {}),
          lockWait,
        },
        sink,
      )
    } finally {
      wallClock.current?.clear()
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
