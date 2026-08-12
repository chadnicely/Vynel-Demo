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
// Composes the routing + notebook + desktop descriptors — the brain's tools
// (delegate / channel-send / list / register-workspace) plus its desktop senses.
// The desktop descriptor excludes itself when boot wired no reader
// (off-Windows / tests), so the channel root carries desktop observation on
// exactly the machines that have it.

import type { Database } from '@vynel/db'
import { defaultEnabledCapabilityIds } from '@vynel/capabilities'
import {
  composeSessionAgents,
  recordAgentRunStarted,
  recordAgentRunCompleted,
} from '@vynel/orchestration'
import type { Logger } from 'pino'
import {
  runGlobalRootTurnCore,
  publishTurnActivityStep,
  type SessionActivityFeed,
  type SessionTurnActivityHandle,
  type SessionSink,
} from '@vynel/session/runtime'
import {
  REPORT_DELIVERY_INSTRUCTIONS,
  type RunGlobalRootReportTurn,
  type TurnEventBroadcaster,
} from '@vynel/session/delegation'
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
  /** The turn-liveness registry — a background channel turn must announce
   *  itself so the open app surfaces it live (the web has no other signal). */
  activityFeed: SessionActivityFeed
  /** The shared live-turn pub/sub — the background turn tees onto its session
   *  channel so it is watchable like any other (Slice ③). */
  turnEvents?: TurnEventBroadcaster
  /** The process-wide desktop-notification reader — absent off-Windows/tests
   *  (the desktop descriptor then excludes itself from the composition). */
  desktopReader?: unknown
  /** Whether the mutating desktop `act_on_app` tool is enabled (env flag). */
  enableDesktopActions?: boolean
}

export interface RunGlobalRootTurnInput {
  userId: string
  userMessageText: string
  /** Set when a CHANNEL drove this turn (Ch4) — threaded onto any delegation the root enqueues. */
  origin?: DelegationOrigin
  /** The inbound channel's kind — stamped on the persisted user row ("via Telegram"). */
  originChannel?: 'telegram' | 'discord' | 'zoom'
  /** The per-message reply instruction (channel pipeline; voice-turn-marker
   *  precedent) — appended to PROVIDER input only, never the persisted row. */
  channelReplyMarker?: string
  /** REPORT-DELIVERY notify turn (session-comms): the inbound message is a
   *  child's report — attribute its row as coming FROM that child. Omit → the
   *  shipped channel-turn rows, byte-for-byte. */
  inboundAttribution?: {
    sourceKind: 'workspace-manager'
    sourceLabel: string
    partialSessionId?: string
    /** The delegation CHAIN key (persona-sessions) — stamped beside the trace key. */
    threadId?: string
  }
  /** REPORT-DELIVERY notify turn: the report-delivery steer, appended to the
   *  system prompt. Omit → the shipped prompt. */
  steerPromptAppend?: string
  /** The liveness-feed origin for this turn. Omit → the channel kind, else
   *  'web' (the shipped behavior); the report-delivery runner passes
   *  'delegation' so the feed reports what is actually running. */
  activityOrigin?: 'delegation'
  /** The delivery queue row driving this notify turn — liveness enrichment. */
  jobId?: string
  model?: string
  /** Surface-up: called for each `approval-requested` the brain's own turn emits (the
   *  core already RECORDED it — web notifier). The channel path pushes the card back
   *  to the sender with it. The turn stays parked until the decision arrives. */
  onApprovalRequested?: (approval: {
    approvalRequestId: string
    toolName: string
    toolInput: unknown
  }) => void
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

  constructor(
    private readonly onApprovalRequested?: RunGlobalRootTurnInput['onApprovalRequested'],
    /** The turn's activity-feed handle — session identity + tool-step narration. */
    private readonly activity?: SessionTurnActivityHandle,
  ) {}

  onEvent(event: SessionEvent): void {
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
    } else if (event.kind === 'session-created') {
      // A fresh root or a mid-turn swap — follow it so the result reports the
      // segment the reply actually landed on (user-message-persisted now
      // arrives first, carrying the pre-swap id on resumed turns).
      this.sessionId = event.session.id
      this.activity?.sessionResolved(event.session.id)
    } else if (event.kind === 'text-chunk') {
      this.resultText += event.textDelta
    } else if (event.kind === 'approval-requested') {
      // Surface-up: the core already recorded the card (web notifier); this hands it
      // to the channel path so the sender is asked too. Auto-approved cards arrive as
      // `approval-auto-resolved` and are deliberately not pushed.
      this.onApprovalRequested?.({
        approvalRequestId: event.approvalRequestId,
        toolName: event.toolName,
        toolInput: event.toolInput,
      })
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

  // Compose the global root's MCP attachment: the routing tools (the root is a
  // MANAGER — list + delegate + channel-send). No workspaceId — the global root
  // has none. Dynamic import keeps the heavy SDK out of module load.
  const { vynelRoutingDescriptor } = await import('@vynel/mcp')
  const { notebookFeatureDescriptor } = await import('@vynel/instructions')
  const { desktopFeatureDescriptor, deriveDesktopPlanConsent } = await import(
    '@vynel/desktop-control'
  )
  // The global root's STABLE identity, resolved pre-lock so the desktop action
  // record can key its rows by it (the SDK id is only assigned mid-stream).
  // `getOrCreatePrimarySession` is idempotent + partial-unique race-safe, so
  // this early call cannot fight the authoritative in-lock `resolveTarget`.
  const conversationTarget = await resolveGlobalRootConversationTarget(deps.db, {
    userId: input.userId,
  })
  const composedMcp = composeSessionMcpServers(
    [vynelRoutingDescriptor, notebookFeatureDescriptor, desktopFeatureDescriptor],
    {
      db: deps.db,
      userId: input.userId,
      sessionId: conversationTarget.primarySessionId,
      appRequest,
      desktopReader: deps.desktopReader,
      enableDesktopActions: deps.enableDesktopActions ?? false,
      // A channel turn carries no UI mode selector, so it runs under the
      // brain's own bypass default (`routes/root/schemas.ts`) — and its desktop
      // consent now says the same thing instead of contradicting it.
      //
      // It used to pass `undefined` → 'display-only', on the reasoning that
      // authority stayed with standing per-app grants. Retiring those grants
      // removed that authority, which left a channel turn able to do NOTHING on
      // the desktop — breaking the whole point of asking Vynel to do something
      // from your phone. Kafi, 2026-08-13: "auto mode means no matter schedule
      // or remote it can do anything user asked, but will show that overlay".
      //
      // ⚠ DELIBERATE SECURITY DEBT, not an oversight. Anyone who reaches the
      // channel drives the desktop with no approval anywhere — the overlay and
      // the access log are the accountability. This is a knowing reversal of
      // "a background turn can never self-grant" (Chad 2026-08-04), taken to get
      // the functionality right first. The turn's ORIGIN is already known here,
      // so the later tightening is a filter on this value — per-channel trust,
      // Vynel's own mobile app trusted where Telegram is not — never a redesign.
      desktopPlanConsent: deriveDesktopPlanConsent('bypass'),
    },
    // The global root has no workspace, so no capability override rows can
    // exist for it — the catalog defaults ARE its enabled set (without this,
    // the notebook's defaultEnabled gated tools would be denied here).
    { enabledCapabilityIds: defaultEnabledCapabilityIds() },
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
    // The channels service sets originChannel; the report-delivery runner sets
    // activityOrigin 'delegation'; 'web' is the defensive fallback.
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
  const sink = new GlobalRootDrainSink(input.onApprovalRequested, activity)
  try {
    await runGlobalRootTurnCore(
      {
        db: deps.db,
        logger: deps.logger,
        ...(deps.turnEvents !== undefined ? { turnEvents: deps.turnEvents } : {}),
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
        ...(input.originChannel !== undefined ? { originChannel: input.originChannel } : {}),
        ...(input.channelReplyMarker !== undefined
          ? { channelReplyMarker: input.channelReplyMarker }
          : {}),
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
        mcpServers: composedMcp.mcpServers,
        allowedMcpToolPatterns: composedMcp.allowedMcpToolPatterns,
        mutatingToolNames: composedMcp.mutatingToolNames,
        askModeApprovalToolNames: composedMcp.askModeApprovalToolNames,
        mcpSystemPromptAppend: composedMcp.systemPromptAppend,
        ...(agentSlugs.length > 0 ? { agents: sessionAgents } : {}),
      },
      sink,
    )
  } finally {
    activity.end()
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
    const turn = await runGlobalRootTurn(deps, {
      userId: input.userId,
      userMessageText: input.reportBody,
      inboundAttribution: {
        sourceKind: 'workspace-manager',
        sourceLabel: input.sourceLabel,
        ...(input.partialSessionId !== undefined
          ? { partialSessionId: input.partialSessionId }
          : {}),
        ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
      },
      // The tick passes the kind's steer (update vs report); the report steer
      // stays the default for older callers.
      steerPromptAppend: input.steerInstructions ?? REPORT_DELIVERY_INSTRUCTIONS,
      activityOrigin: 'delegation',
      ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
    })
    return { sessionId: turn.sessionId, resultText: turn.resultText }
  }
}
