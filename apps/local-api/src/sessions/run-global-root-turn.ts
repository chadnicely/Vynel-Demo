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
// THE BOUND (background-turns BT4, audit R2-B): a caller that passes
// `wallClock` gets the interactive streams' wall clock on its turn — armed
// when the turn takes the root lock, suspended while a card or an ask is
// parked, and on expiry the turn fails the streams' way (the honest failure
// row, the interrupt that ends the stream and releases the lock through the
// core's chain, the feed's `failed`) and `runGlobalRootTurn` throws the same
// typed failure. Channels pass `VYNEL_INTERACTIVE_TURN_MAX_MS`; a schedule's
// global fire passes the delegated cap. Without it the turn is unbounded —
// the shipped shape, kept for the report-delivery runner, which is already
// capped by the delivery tick's `routeRequest`.
//
// Composes the routing + notebook + desktop descriptors — the brain's tools
// (delegate / channel-send / list / register-workspace) plus its desktop senses.
// The desktop descriptor excludes itself when boot wired no reader
// (off-Windows / tests), so the channel root carries desktop observation on
// exactly the machines that have it.

import type { Database } from '@vynel/db'
import type { PendingAskRegistry } from '@vynel/asks'
import { defaultEnabledCapabilityIds } from '@vynel/capabilities'
import { findChatSessionById } from '@vynel/chat/repositories'
import { resolveTurnSessionSettings } from '@vynel/chat'
import {
  ApprovalWaitGate,
  composeSessionAgents,
  recordAgentRunStarted,
  recordAgentRunCompleted,
} from '@vynel/orchestration'
import type { Logger } from 'pino'
import { DEFAULT_SESSION_MODE, toPermissionMode } from '@vynel/session'
import {
  fitPinnedModelToSession,
  runGlobalRootTurnCore,
  publishTurnActivityStep,
  startTurnWallClock,
  trackApprovalParks,
  failTurnOnWallClock,
  type SessionActivityFeed,
  type SessionTurnActivityHandle,
  type SessionSink,
  type TurnWallClock,
  type TurnWallClockFailure,
} from '@vynel/session/runtime'
import {
  REPORT_DELIVERY_INSTRUCTIONS,
  type RunGlobalRootReportTurn,
  type TurnEventBroadcaster,
} from '@vynel/session/delegation'
import type { DelegationOrigin } from '@vynel/orchestration'
import type { HonoAppRequestFn } from '../factory.js'
import { composeSessionMcpServers } from './compose-session-mcp-servers.js'
import { createTurnSessionCarrier, type TurnSessionCarrier } from './turn-session-header.js'
import type { ReadEnabledFeatureKeys } from './enabled-feature-keys.js'
import { resolveSessionToolPolicies } from './session-tool-catalog.js'
import { resolveGlobalRootConversationTarget } from './resolve-global-root-conversation.js'
import { ensureGlobalRootWorkspaceDir } from './global-root-workspace.js'
import { serializeDelegationOrigin, DELEGATION_ORIGIN_HEADER } from './delegation-origin-header.js'
import { wrapAppRequestWithMode } from './delegation-mode-header.js'
import { loadEnv } from '../env.js'
import { resolveDesktopActionsEnabled } from './resolve-desktop-actions-enabled.js'

// How long a channel turn's ask_user form waits before expiring — matched to
// the approvals reaper's ~10-minute real-world bound, the app's standing
// answer to "how long may a background turn wait on a human". Shared with the
// WORKSPACE channel runner (`run-workspace-channel-turn.ts`): both are the same
// question asked from the same place, and two numbers would be two answers.
export const CHANNEL_ASK_TIMEOUT_MS = 10 * 60 * 1000

// The drain sink narrows on the SAME `ChatTurnEvent` the runner emits, taken
// straight off `SessionSink` so this edge never needs a `@vynel/chat` dependency.
type SessionEvent = Parameters<SessionSink['onEvent']>[0]

export interface RunGlobalRootTurnDeps {
  db: Database
  logger: Logger
  /** The in-process API dispatcher (`c.var.appRequest`) — the routing MCP tools dispatch through it. */
  appRequest: HonoAppRequestFn
  /** Per-composition entitlement read (tier filtering). Absent = fail-open. */
  readEnabledFeatureKeys?: ReadEnabledFeatureKeys
  /** The process-wide parked-ask registry — attaching it gives channel turns
   *  ask_user with the bounded wait. Absent (older callers, tests) = ask-free
   *  turn, exactly the pre-slice shape. */
  askWaiters?: PendingAskRegistry
  /** The turn-liveness registry — a background channel turn must announce
   *  itself so the open app surfaces it live (the web has no other signal). */
  activityFeed: SessionActivityFeed
  /** The shared live-turn pub/sub — the background turn tees onto its session
   *  channel so it is watchable like any other (Slice ③). */
  turnEvents?: TurnEventBroadcaster
  /** The process-wide desktop-notification reader — absent off-Windows/tests
   *  (the desktop descriptor then excludes itself from the composition). */
  desktopReader?: unknown
}

export interface RunGlobalRootTurnInput {
  userId: string
  userMessageText: string
  /** Set when a CHANNEL drove this turn (Ch4) — threaded onto any delegation the root enqueues. */
  origin?: DelegationOrigin
  /** The inbound channel's kind — stamped on the persisted user row ("via Telegram"). */
  originChannel?: 'telegram' | 'discord' | 'zoom'
  /** The per-message marker (channel pipeline; voice-turn-marker precedent) —
   *  appended to PROVIDER input only, never the persisted row. Channels pass
   *  the reply-through-the-tool instruction; a schedule fire passes its fire
   *  frame (schedule-fire framing). */
  channelReplyMarker?: string
  /** REPORT-DELIVERY notify turn (session-comms): the inbound message is a
   *  child's report — attribute its row as coming FROM that child. Omit → the
   *  shipped channel-turn rows, byte-for-byte. */
  inboundAttribution?: {
    sourceKind: 'workspace-manager' | 'system'
    sourceLabel: string
    partialSessionId?: string
    /** The delegation CHAIN key (persona-sessions) — stamped beside the trace key. */
    threadId?: string
  }
  /** REPORT-DELIVERY notify turn: the report-delivery steer, appended to the
   *  system prompt. Omit → the shipped prompt. */
  steerPromptAppend?: string
  /** Override the delivery-turn derivation below. Omitted, an ATTRIBUTED
   *  inbound (`inboundAttribution` set) is treated as a delivery the root
   *  absorbs — no context nudge, no automatic continuation. A schedule fire
   *  passes `true`: its row is attributed (the scheduler speaking, a system
   *  notice) but the turn IS work and keeps the genuine-turn machinery. */
  autoContinue?: boolean
  /** The liveness-feed origin for this turn. Omit → the channel kind, else
   *  'web' (the shipped behavior); the report-delivery runner passes
   *  'delegation', a global schedule fire passes 'schedule' (BT1), so the
   *  feed reports what is actually running. */
  activityOrigin?: 'delegation' | 'schedule'
  /** The delivery queue row driving this notify turn — liveness enrichment. */
  jobId?: string
  /** A stable inbound-row id (the delivery job's) so a retried notify turn
   *  never lands its report twice (session-hardening A3c). */
  inboundMessageId?: string
  model?: string
  /** Surface-up: called for each `approval-requested` the brain's own turn emits (the
   *  core already RECORDED it — web notifier). The channel path pushes the card back
   *  to the sender with it. The turn stays parked until the decision arrives. */
  onApprovalRequested?: (approval: {
    approvalRequestId: string
    toolName: string
    toolInput: unknown
  }) => void
  /** Surface-up's other edge: a card this turn raised was decided (approved,
   *  denied, or reaped). The report-delivery runner pairs it with the one
   *  above to suspend/resume the delivery's cap clock. */
  onApprovalResolved?: (approval: { approvalRequestId: string }) => void
  /** The RUNNING SDK session id, as the stream reveals it (and again on a
   *  mid-turn swap) — the delegation tick's cancel bridge + hard-cap lever. */
  onSessionResolved?: (sdkSessionId: string) => void
  /** The turn's bound (BT4): the WORKING-time budget it may hold the root lock
   *  for — the interactive streams' wall clock (`startTurnWallClock`), armed
   *  when the lock is taken (queue time is the holder's budget), suspended
   *  while a card or an ask is parked, cleared at turn end. Past it the turn
   *  fails the streams' way and the runner throws `TurnWallClockExceededError`.
   *  Channels pass `VYNEL_INTERACTIVE_TURN_MAX_MS`; a schedule's global fire
   *  passes `VYNEL_DELEGATED_TURN_MAX_MS`. Omit → unbounded (the shipped shape). */
  wallClock?: { maxMs: number }
}

/** The wall clock fired on a bounded turn — the streams' typed failure
 *  (`session-errored { errorCode: 'turn-wall-clock-exceeded' }`) as the
 *  runner's throw: same code, same message as the failure row it persisted.
 *  Callers (the channel consumer, a schedule's run row) record the message;
 *  `errorCode` lets them tell the cap from a provider failure without
 *  matching text. */
export class TurnWallClockExceededError extends Error {
  readonly errorCode: string

  constructor(failure: TurnWallClockFailure) {
    super(failure.errorMessage)
    this.name = 'TurnWallClockExceededError'
    this.errorCode = failure.errorCode
  }
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
  /** Set the instant the wall clock fires (BT4) — resolves to the failure the
   *  streams' helper built once it has landed the row + the interrupt. */
  private wallClockFailure: Promise<TurnWallClockFailure> | null = null
  /** The turn's durable outcome (Move 3 feeder fix) — a terminal
   *  `session-errored` marks the envelope 'failed', the workspace streams'
   *  rule; read by the runner's `activity.end(...)`. */
  turnOutcome: 'ended' | 'failed' = 'ended'

  constructor(
    private readonly hooks: Pick<
      RunGlobalRootTurnInput,
      'onApprovalRequested' | 'onApprovalResolved' | 'onSessionResolved'
    >,
    /** The turn's activity-feed handle — session identity + tool-step narration. */
    private readonly activity?: SessionTurnActivityHandle,
    /** The turn's session carrier — composed BEFORE this sink exists, so the
     *  sink hands it the id the moment the stream reveals one. Feature tools
     *  that record the conversation (asks) read it from there. */
    private readonly turnSession?: TurnSessionCarrier,
    /** Sees every event before the drain bookkeeping — the wall clock's
     *  approval park tracker rides here (a parked card suspends the clock),
     *  the SSE sink's shape. */
    private readonly onTurnEvent?: (event: SessionEvent) => void,
  ) {}

  /** The wall clock fired. The outcome flips BEFORE `fail` issues the
   *  interrupt: the provider ends an interrupted stream cleanly (no terminal
   *  error event), so nothing downstream would otherwise call this turn
   *  failed — and the core's return races the helper's continuation. */
  failOnWallClock(fail: () => Promise<TurnWallClockFailure>): Promise<TurnWallClockFailure> {
    this.turnOutcome = 'failed'
    this.wallClockFailure = fail()
    return this.wallClockFailure
  }

  onEvent(event: SessionEvent): void {
    this.onTurnEvent?.(event)
    // Narrate tool steps + approval bells on the feed FIRST (independent of the
    // drain bookkeeping below) — a background channel turn is otherwise
    // invisible to the desktop overlay.
    if (this.activity !== undefined) publishTurnActivityStep(this.activity, event)
    if (event.kind === 'user-message-persisted') {
      // Capture from user-message-persisted — it fires on BOTH the new AND resumed
      // branches, so every channel-brain turn (turns 2+ are resumed) sets it.
      // `session-created` fires only on a new/swapped segment, so it would leave a
      // resumed turn without a session id and `requireResult` would throw.
      this.sessionId = event.message.sessionId
      this.activity?.sessionResolved(event.message.sessionId)
      this.turnSession?.resolve(event.message.sessionId)
      this.hooks.onSessionResolved?.(event.message.sessionId)
    } else if (event.kind === 'session-created') {
      // A fresh root or a mid-turn swap — follow it so the result reports the
      // segment the reply actually landed on (user-message-persisted now
      // arrives first, carrying the pre-swap id on resumed turns).
      this.sessionId = event.session.id
      this.activity?.sessionResolved(event.session.id)
      this.turnSession?.resolve(event.session.id)
      this.hooks.onSessionResolved?.(event.session.id)
    } else if (event.kind === 'text-chunk') {
      this.resultText += event.textDelta
    } else if (event.kind === 'approval-requested') {
      // Surface-up: the core already recorded the card (web notifier); this hands it
      // to the channel path so the sender is asked too. Auto-approved cards arrive as
      // `approval-auto-resolved` and are deliberately not pushed.
      this.hooks.onApprovalRequested?.({
        approvalRequestId: event.approvalRequestId,
        toolName: event.toolName,
        toolInput: event.toolInput,
      })
    } else if (event.kind === 'approval-resolved') {
      this.hooks.onApprovalResolved?.({ approvalRequestId: event.approvalRequestId })
    } else if (event.kind === 'session-errored') {
      this.streamErrorMessage = event.errorMessage
      if (!event.isRecoverable) this.turnOutcome = 'failed'
    }
  }

  /** The drained result — throws (wall clock FIRST: it is the cause of whatever
   *  the interrupt left behind; then no-session-id, then errored, matching the
   *  pre-collapse order) when the turn didn't produce a usable session. */
  async requireResult(): Promise<RunGlobalRootTurnResult> {
    if (this.wallClockFailure !== null) {
      throw new TurnWallClockExceededError(await this.wallClockFailure)
    }
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
  // The global root's STABLE identity, resolved pre-lock so the desktop action
  // record can key its rows by it (the SDK id is only assigned mid-stream).
  // `getOrCreatePrimarySession` is idempotent + partial-unique race-safe, so
  // this early call cannot fight the authoritative in-lock `resolveTarget`.
  const conversationTarget = await resolveGlobalRootConversationTarget(deps.db, {
    userId: input.userId,
  })
  const swapThreshold = loadEnv().VYNEL_CONTEXT_PRESSURE_THRESHOLD
  // The turn's settings — what the user chose for the GLOBAL conversation
  // (its head segment's row), `input ?? row ?? DEFAULT` (session-hardening D1:
  // "channels run the global row's mode when set, else auto"). No more fixed
  // unattended default: a stored Ask cards through the channel's own card
  // push, a stored model/effort runs here too. The model is fit-checked
  // against the head (a Telegram turn dying with "Prompt is too long" has
  // nobody watching an error row); never persisted.
  const globalRow =
    conversationTarget.resumeSdkSessionId !== null
      ? findChatSessionById(deps.db, conversationTarget.resumeSdkSessionId)
      : null
  const turnSettings = resolveTurnSessionSettings({ model: input.model }, globalRow)
  const permissionMode = toPermissionMode(turnSettings.mode ?? DEFAULT_SESSION_MODE)
  let turnModel = turnSettings.model
  if (turnModel !== undefined && conversationTarget.resumeSdkSessionId !== null) {
    const fit = fitPinnedModelToSession(deps.db, {
      resumeSdkSessionId: conversationTarget.resumeSdkSessionId,
      pinnedModel: turnModel,
      ...(swapThreshold !== undefined ? { threshold: swapThreshold } : {}),
    })
    if (fit.wasReplaced) {
      deps.logger.info(
        { pinnedModel: turnModel, model: fit.model ?? null, occupancyTokens: fit.occupancyTokens },
        'channel turn: the model pick cannot hold the global occupancy — running on the session model',
      )
      turnModel = fit.model
    }
  }
  const autoBuildout = globalRow?.autoBuildout === true

  // Origin-wrap at the edge — the core stays origin-agnostic (the additive
  // invariant) — then the MODE header, so any delegation this turn enqueues
  // inherits the resolved mode (D4: children inherit the creator's settings;
  // the interactive streams stamp the same way).
  const originAwareAppRequest =
    input.origin !== undefined ? wrapAppRequestWithOrigin(deps.appRequest, input.origin) : deps.appRequest
  const appRequest = wrapAppRequestWithMode(originAwareAppRequest, permissionMode)
  // This turn's chat-session identity. Composed here (before the toolset) and
  // filled by the drain sink from the stream's first frame — the read half is
  // what lets an `ask_user` on a channel turn name the conversation it parked.
  const turnSession = createTurnSessionCarrier()
  // ONE gate per turn (the streams' rule): parked cards (the sink's tracker)
  // and parked asks (the descriptor) both mark it; the wall clock — when the
  // caller bounds the turn — measures only what is left. Inert otherwise.
  const waitGate = new ApprovalWaitGate()

  // Compose the global root's MCP attachment: the routing tools (the root is a
  // MANAGER — list + delegate + channel-send). No workspaceId — the global root
  // has none. Dynamic import keeps the heavy SDK out of module load.
  const { vynelRoutingDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  const { desktopFeatureDescriptor, deriveDesktopPlanConsent } = await import(
    '@vynel/desktop-control'
  )
  // whoami — the channel-driven brain knows who it is too (built with the swap
  // threshold in force, the env knob the boundary op honors).
  const { buildSessionFeatureDescriptor } = await import('@vynel/session/mcp')
  const sessionFeatureDescriptor = buildSessionFeatureDescriptor(
    swapThreshold !== undefined ? { swapThreshold } : {},
  )
  const enabledFeatureKeys = deps.readEnabledFeatureKeys?.()
  const toolPolicies = resolveSessionToolPolicies(deps.db, {
    userId: input.userId,
    desktopToolNames: desktopFeatureDescriptor.toolNames ?? [],
  })
  // ask_user now rides channel turns too — the Telegram flow ("Claude needs
  // your input" nudge is already wired on ask.created) — but BOUNDED: nobody
  // may be looking at the app, so an unanswered form expires and the turn
  // proceeds with judgment instead of parking a background job forever.
  // Interactive streams keep the recorded no-timeout decision (fork #1).
  const askTurnKey = crypto.randomUUID()
  const askFeatureDescriptors =
    deps.askWaiters !== undefined
      ? [
          (await import('@vynel/asks/mcp')).buildAskFeatureDescriptor({
            waiters: deps.askWaiters,
            turnKey: askTurnKey,
            timeoutMs: CHANNEL_ASK_TIMEOUT_MS,
            waitGate,
            logger: deps.logger,
          }),
        ]
      : []
  const composedMcp = composeSessionMcpServers(
    [
      vynelRoutingDescriptor,
      notebookFeatureDescriptor,
      sessionFeatureDescriptor,
      ...askFeatureDescriptors,
      desktopFeatureDescriptor,
    ],
    {
      db: deps.db,
      userId: input.userId,
      sessionId: conversationTarget.primarySessionId,
      // The CHAT session, distinct from the stable primary above — filled by
      // the drain sink from the stream's first frame (see the carrier below).
      resolveChatSessionId: turnSession.current,
      appRequest,
      desktopReader: deps.desktopReader,
      // Resolved PER TURN (Settings → Desktop control) — a channel or
      // schedule turn honours the toggle the same way the web chat does.
      enableDesktopActions: resolveDesktopActionsEnabled(deps.db, input.userId),
      // The SAME resolved mode the turn runs under (D1) — the desktop plan
      // envelope and the approval floor never disagree about what this turn
      // may do. Under the default `auto` this is standing consent: anyone who
      // reaches the channel drives the desktop with no approval anywhere — the
      // overlay and the access log are the accountability (Kafi 2026-08-13:
      // "auto mode means no matter schedule or remote it can do anything user
      // asked, but will show that overlay"; a knowing reversal of "a
      // background turn can never self-grant", Chad 2026-08-04, taken to get
      // the functionality right first — ⚠ DELIBERATE SECURITY DEBT). A user
      // who set Ask on the global row now gets the approval card through the
      // channel's own card push instead. The turn's ORIGIN is known here, so
      // the later tightening is a filter on this value — per-channel trust —
      // never a redesign.
      desktopPlanConsent: deriveDesktopPlanConsent(permissionMode),
    },
    // The global root has no workspace, so no capability override rows can
    // exist for it — the catalog defaults ARE its enabled set (without this,
    // the notebook's defaultEnabled gated tools would be denied here).
    {
      enabledCapabilityIds: defaultEnabledCapabilityIds(),
      ...(enabledFeatureKeys !== undefined ? { enabledFeatureKeys } : {}),
      toolPolicies,
      surfaceKind: 'global-channel',
    },
  )

  // USER-scope agents ride channel turns too — a Telegram ask can spawn the
  // same subagents the app chats can (agents parity, one lifecycle).
  const sessionAgents = await composeSessionAgents(deps.db, {
    userId: input.userId,
    workspaceId: null,
  })
  const agentSlugs = Object.keys(sessionAgents)
  const agentRunId = agentSlugs.length > 0 ? crypto.randomUUID() : null
  if (agentRunId) {
    try {
      await recordAgentRunStarted(deps.db, {
        runId: agentRunId,
        userId: input.userId,
        workspaceId: null,
        agentSlugs,
        startedAt: new Date().toISOString(),
      })
    } catch (err) {
      deps.logger.warn({ err }, 'failed to record agent.run-started')
    }
  }

  // Announce on the session-activity feed — this background turn is invisible
  // to the app otherwise (the whole reason a Telegram reply never surfaced
  // without a reload). Ended in the finally even when the turn throws.
  // Delivery-turn enrichment (persona-sessions): the notify turn speaks AS the
  // child whose message it carries; jobId/keys let the live views settle-match.
  const activity = deps.activityFeed.begin({
    userId: input.userId,
    scopeKind: 'global',
    // Identity on the wire (session-hardening D1): every global turn names the
    // global primary it runs on, so readers match by identity — the desktop
    // overlay's Stop, the pre-resolution windows — never by an absence.
    primarySessionId: conversationTarget.primarySessionId,
    // The channels service sets originChannel; the report-delivery runner sets
    // activityOrigin 'delegation', a global schedule fire 'schedule'; 'web' is
    // the defensive fallback.
    origin: input.activityOrigin ?? input.originChannel ?? 'web',
    ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
    ...(input.inboundAttribution?.partialSessionId !== undefined
      ? { partialSessionId: input.inboundAttribution.partialSessionId }
      : {}),
    ...(input.inboundAttribution?.threadId !== undefined
      ? { threadId: input.inboundAttribution.threadId }
      : {}),
    ...(input.inboundAttribution !== undefined
      ? { personaName: input.inboundAttribution.sourceLabel }
      : {}),
  })
  // Parked cards suspend the wall clock; the sink feeds the tracker every event.
  const approvalParks = trackApprovalParks(waitGate)
  const sink = new GlobalRootDrainSink(input, activity, turnSession, approvalParks.onTurnEvent)
  // The bound (BT4) — the streams' wall clock, armed by `resolveTarget` below
  // (the core's FIRST in-lock call, called again per continuation; `??=` arms
  // once) so it measures the time this turn HOLDS the root lock; cleared in
  // the finally. On expiry the helper lands the honest failure row and
  // interrupts the head, so the provider ends the stream and the lock
  // releases through the core's chain; the sink turns that into the typed
  // throw. A ref, not a `let`: the arm happens inside the core's callback.
  const wallClock: { current: TurnWallClock | null } = { current: null }
  const armWallClock = (): void => {
    const bound = input.wallClock
    if (bound === undefined) return
    wallClock.current ??= startTurnWallClock({
      maxMs: bound.maxMs,
      waitGate,
      logger: deps.logger,
      onExpire: async () => {
        await sink.failOnWallClock(() =>
          failTurnOnWallClock(
            { db: deps.db, logger: deps.logger },
            { sessionId: turnSession.current(), maxMs: bound.maxMs },
          ),
        )
      },
    })
  }
  try {
    await runGlobalRootTurnCore(
      {
        db: deps.db,
        logger: deps.logger,
        ...(deps.turnEvents !== undefined ? { turnEvents: deps.turnEvents } : {}),
        // Resolve the global root + ensure its hidden cwd, INSIDE the lock (the runner
        // calls this) — apps/local-api owns the env-coupled user-data-dir read.
        resolveTarget: async () => {
          armWallClock()
          const target = await resolveGlobalRootConversationTarget(deps.db, { userId: input.userId })
          ensureGlobalRootWorkspaceDir()
          return target
        },
      },
      {
        userId: input.userId,
        userMessageText: input.userMessageText,
        permissionMode,
        ...(turnModel !== undefined ? { model: turnModel } : {}),
        ...(turnSettings.thinkingEffort !== undefined
          ? { thinkingEffort: turnSettings.thinkingEffort }
          : {}),
        ...(autoBuildout ? { autoBuildout: true } : {}),
        ...(input.originChannel !== undefined ? { originChannel: input.originChannel } : {}),
        ...(input.channelReplyMarker !== undefined
          ? { channelReplyMarker: input.channelReplyMarker }
          : {}),
        ...(input.inboundMessageId !== undefined ? { userMessageId: input.inboundMessageId } : {}),
        // The notify-turn variant (session-comms): the child's attribution on
        // the inbound row + the report-delivery steer.
        ...(input.inboundAttribution !== undefined
          ? {
              messageAttribution: {
                userSourceKind: input.inboundAttribution.sourceKind,
                userSourceLabel: input.inboundAttribution.sourceLabel,
                ...(input.inboundAttribution.partialSessionId !== undefined
                  ? { partialSessionId: input.inboundAttribution.partialSessionId }
                  : {}),
                ...(input.inboundAttribution.threadId !== undefined
                  ? { threadId: input.inboundAttribution.threadId }
                  : {}),
              },
            }
          : {}),
        ...(input.steerPromptAppend !== undefined
          ? { steerPromptAppend: input.steerPromptAppend }
          : {}),
        // A delivery turn (a child's report / update absorbed by the root)
        // is never work: no context nudge, no automatic continuation. The
        // caller's explicit `autoContinue` wins — a schedule fire is
        // attributed AND work (schedule-fire framing).
        ...(input.autoContinue !== undefined
          ? { autoContinue: input.autoContinue }
          : input.inboundAttribution !== undefined
            ? { autoContinue: false }
            : {}),
        mcpServers: composedMcp.mcpServers,
        deniedMcpToolPatterns: composedMcp.deniedMcpToolPatterns,
        mutatingToolNames: composedMcp.mutatingToolNames,
        askModeApprovalToolNames: composedMcp.askModeApprovalToolNames,
        mcpSystemPromptAppend: composedMcp.systemPromptAppend,
        ...(agentSlugs.length > 0 ? { agents: sessionAgents } : {}),
        // The same swap-threshold knob whoami above was built with.
        ...(swapThreshold !== undefined ? { pressureThreshold: swapThreshold } : {}),
      },
      sink,
    )
  } catch (err) {
    // A thrown core run (resolve failure, drain error re-raised by
    // requireResult) is a failed turn even without a terminal event.
    sink.turnOutcome = 'failed'
    throw err
  } finally {
    wallClock.current?.clear()
    activity.end(sink.turnOutcome)
    // A parked ask must not outlive its turn: cancel THIS turn's waiters and
    // expire their rows — the interactive streams' cleanup mirrored, GUARD
    // INCLUDED: a bookkeeping failure here must never replace the turn's real
    // outcome (boot expiry sweeps any row this misses).
    if (deps.askWaiters !== undefined) {
      try {
        const cancelledAskIds = deps.askWaiters.cancelForTurn(askTurnKey)
        if (cancelledAskIds.length > 0) {
          const { expireAskRequests } = await import('@vynel/asks')
          expireAskRequests(deps.db, { askIds: cancelledAskIds }, { logger: deps.logger })
        }
      } catch (err) {
        deps.logger.warn({ err }, 'failed to expire cancelled ask requests at turn end')
      }
    }
    if (agentRunId) {
      try {
        await recordAgentRunCompleted(deps.db, {
          runId: agentRunId,
          userId: input.userId,
          workspaceId: null,
          completedAt: new Date().toISOString(),
        })
      } catch (err) {
        deps.logger.warn({ err }, 'failed to record agent.run-completed')
      }
    }
  }
  return sink.requireResult()
}

/** The GLOBAL-root notify runner the delegation tick's report-delivery branch
 *  calls (session-comms): one `runGlobalRootTurn` with the child's attribution
 *  on the inbound row, the report-delivery steer, and the feed origin
 *  'delegation'. Everything else — root-turn lock, routing toolset, delegation
 *  catch-up, agents — is the channel runner's shipped shape, which is exactly
 *  the point: the root ABSORBS the report the way it absorbs any message. */
export function buildGlobalRootReportTurnRunner(
  deps: RunGlobalRootTurnDeps,
): RunGlobalRootReportTurn {
  return async (input) => {
    // The delivery's cap clock: only cards THIS turn raised move the gate (a
    // decision arriving for a card it never parked must not release someone
    // else's suspension — the routed handler's rule).
    const parkedApprovalIds = new Set<string>()
    const waitGate = input.waitGate
    const turn = await runGlobalRootTurn(deps, {
      userId: input.userId,
      userMessageText: input.reportBody,
      ...(waitGate !== undefined
        ? {
            onApprovalRequested: ({ approvalRequestId }) => {
              parkedApprovalIds.add(approvalRequestId)
              waitGate.markParked()
            },
            onApprovalResolved: ({ approvalRequestId }) => {
              if (parkedApprovalIds.delete(approvalRequestId)) waitGate.markResolved()
            },
          }
        : {}),
      ...(input.onSessionResolved !== undefined
        ? { onSessionResolved: input.onSessionResolved }
        : {}),
      inboundAttribution: {
        sourceKind: input.sourceKind ?? 'workspace-manager',
        sourceLabel: input.sourceLabel,
        ...(input.partialSessionId !== undefined
          ? { partialSessionId: input.partialSessionId }
          : {}),
        ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
      },
      // The tick passes the kind's steer (update vs report); the report steer
      // stays the default for older callers.
      steerPromptAppend: input.steerInstructions ?? REPORT_DELIVERY_INSTRUCTIONS,
      // The channel that asked for the work this report is about (channel
      // report protocol): the ROOT is the requester here, so this turn is what
      // answers the person waiting on Telegram — `reply_to_channel` reaches it
      // through the routing descriptor, addressed by this origin, and the
      // marker rides PROVIDER input only (no `originChannel`: this row is a
      // report FROM A CHILD, not a message the channel sent).
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.channelReplyMarker !== undefined
        ? { channelReplyMarker: input.channelReplyMarker }
        : {}),
      activityOrigin: 'delegation',
      ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
      ...(input.inboundMessageId !== undefined ? { inboundMessageId: input.inboundMessageId } : {}),
    })
    return { sessionId: turn.sessionId, resultText: turn.resultText }
  }
}
