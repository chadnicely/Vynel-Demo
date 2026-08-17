// SSE stream for the spawned-session turn route (sessions-surface Slice ③a) —
// the user chatting DIRECTLY into a session the root spawned. Mirrors
// `chat-turn.ts`'s shape (compose → startChatTurn → SSE frames) with the three
// locked decisions applied:
//
//   1. The turn attaches the BACKGROUND MCP set — exactly what the session's
//      delegated turns attach (workspace-grounded → the plain background
//      composer with its own workspaceId; global-grounded → NOTHING). One
//      consistent toolset per session, zero deferred-tool flip-flop.
//   2. The turn always lands on the chain HEAD: the target resolves by its
//      CURRENT segment handle, and the head is re-read after any queue wait so
//      a superseded segment is never written.
//   3. A user turn QUEUES behind a running delegated task on the same session
//      (the shared `SessionTargetLocks` FIFO); a `turn-queued` SSE sentinel
//      (the `turn-stream-ended` precedent — no ChatTurnEvent kind) tells the
//      composer it is waiting.
//   4. The turn carries the ONE continuity step every continuing identity
//      runs (`withBoundaryContinuity` on the stream, still under the target
//      lock): a session driven only by direct messages must not ride to the
//      ceiling while its delegated turns would have swapped it.

import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { z } from 'zod'
import { NotFoundError } from '@vynel/errors'
import {
  startChatTurn,
  runTurnWithContinuations,
  type ContinuationTurn,
} from '@vynel/session/runtime'
import { toPermissionMode, DEFAULT_SESSION_MODE } from '@vynel/session'
import { isPrimarySwapping, linkPrimarySessionToSdkSession } from '@vynel/session/continuity'
import { findRoutableSessionBySegmentId, findRoutableSessionById } from '@vynel/session/spawned'
import {
  resolveTurnSessionSettings,
  persistTurnSessionSettings,
  type ChatTurnEvent,
} from '@vynel/chat'
import { findChatSessionById } from '@vynel/chat/repositories'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import type { AppEnv } from '../factory.js'
import { buildEnabledFeatureKeysReader } from '../sessions/enabled-feature-keys.js'
import { resolveSessionToolPolicies } from '../sessions/session-tool-catalog.js'
import {
  buildDelegatedTurnMcpComposer,
  buildWorkspaceBackgroundMcpComposer,
} from '../sessions/build-workspace-background-mcp.js'
import {
  composeSessionMcpServers,
  mergeComposedSessionMcpServers,
} from '../sessions/compose-session-mcp-servers.js'
import { prepareComposerMentionTurn } from '../sessions/composer-mention-turn.js'
import { createTurnSessionCarrier } from '../sessions/turn-session-header.js'
import { resolveSpawnedSessionRunCwd } from '../sessions/spawned-session-ground.js'
import { writeSseSafely } from './write-sse-safely.js'
import { loadEnv } from '../env.js'
import type { StartSessionTurnRequestSchema } from '../routes/sessions/schemas.js'

type StartSessionTurnInput = z.infer<typeof StartSessionTurnRequestSchema>

export async function streamSpawnedSessionTurn(
  c: Context<AppEnv>,
  sessionId: string,
  input: StartSessionTurnInput,
): Promise<Response> {
  const db = c.var.db
  const userId = c.var.user.id

  // Resolve the ROUTABLE primary from the tool/UI handle — the CURRENT segment
  // id `list_sessions`/`create_session` hand out and the Sessions overview
  // lists as the entry's sessionId. Spawned sessions AND agent colleagues both
  // resolve (redesign G5/D7 — messaging a colleague from its conversation is
  // the same direct-message semantics as a mention); unknown, foreign, and
  // other scopes all 404 identically (no enumeration leak). By construction
  // the handle IS the linked head, so an unlinked primary can never resolve.
  const spawned = findRoutableSessionBySegmentId(db, { userId, sessionId })
  if (spawned === null) {
    throw new NotFoundError('session', sessionId)
  }

  // The session's ground (locked decision 1): its workspace's folder + the
  // PLAIN background set for a workspace-grounded session, or the hidden
  // global-root cwd for a global-grounded one. NOTE: "byte-for-byte what its
  // delegated turns attach" no longer holds literally — delegated turns compose
  // the INTERACTIVE vynel descriptor and (since desktop-autopilot) the desktop
  // server. The desktop half is matched below; the vynel delta is pre-existing
  // and stays within ONE server name, so it never strips a server.
  const runCwdPath = resolveSpawnedSessionRunCwd(db, spawned)
  // Per-session settings resolution: explicit input ?? the session's persisted
  // setting ?? the surface default. Read off the HANDLE segment pre-lock —
  // settings are swap-stable (copied forward onto fresh segments), so the
  // post-wait head carries the same values.
  const turnSettings = resolveTurnSessionSettings(input, findChatSessionById(db, sessionId))
  const turnPermissionMode = toPermissionMode(turnSettings.mode ?? DEFAULT_SESSION_MODE)
  // The turn's own session identity — the segment it resumes (re-resolved
  // after the queue wait below, and again on a mid-turn compaction swap). The
  // dock the user has open on this thread is keyed by that same segment id.
  const turnSession = createTurnSessionCarrier(sessionId)
  const turnSessionAppRequest = turnSession.wrapAppRequest(c.var.appRequest)
  // The toolset per scope: a SPAWNED session keeps its standing shape (the
  // plain background set when workspace-grounded, nothing when global). An
  // agent COLLEAGUE composes the DELEGATED 'agent-session' set instead (G5's
  // recorded MCP-set parity): the same interactive/routing toolset + the
  // agent-session caller identity its mention runs carry — so the colleague's
  // own send_message updates/reports resolve their requester correctly, and
  // its toolset never flip-flops by turn origin (the deferred-tool trap).
  const readEnabledFeatureKeys = buildEnabledFeatureKeysReader(c.var.hubSession)
  // whoami for the one branch no shared composer covers (below) — built with
  // the swap threshold in force, like every other site.
  const { buildSessionFeatureDescriptor } = await import('@vynel/session/mcp')
  const swapThreshold = loadEnv().VYNEL_CONTEXT_PRESSURE_THRESHOLD
  const composedBackgroundMcp =
    spawned.scope === 'agent'
      ? (await buildDelegatedTurnMcpComposer(turnSessionAppRequest, {}, readEnabledFeatureKeys))({
          db,
          userId,
          workspaceId: spawned.workspaceId,
          target: 'agent-session',
          targetPrimarySessionId: spawned.id,
        })
      : spawned.workspaceId !== null
        ? (await buildWorkspaceBackgroundMcpComposer(turnSessionAppRequest, readEnabledFeatureKeys))({
            db,
            userId,
            workspaceId: spawned.workspaceId,
            surfaceKind: 'spawned',
            primarySessionId: spawned.id,
          })
        : // A GLOBAL-grounded spawned session composes NOTHING else on this
          // path today — while its DELEGATED turns compose the root toolset
          // (`buildDelegatedTurnMcpComposer`, 2026-07-26): a per-origin
          // toolset difference the one-toolset rule warns about, recorded as
          // a deferred product call (route this branch through the delegated
          // composer). It still knows who it is: whoami is every session's
          // (continuity arc requirement 2).
          composeSessionMcpServers(
            [buildSessionFeatureDescriptor(swapThreshold !== undefined ? { swapThreshold } : {})],
            {
              db,
              userId,
              sessionId: spawned.id,
              resolveChatSessionId: turnSession.current,
              appRequest: turnSessionAppRequest,
            },
            { toolPolicies: resolveSessionToolPolicies(db, { userId }), surfaceKind: 'spawned' },
          )

  // DESKTOP PARITY WITH THIS SESSION'S DELEGATED TURNS (desktop-autopilot).
  // The delegated composer attaches the desktop server to a 'spawned-session'
  // target, so this interactive path must too — otherwise the user hands a
  // desktop task to a spawned session (server attached), then types into that
  // same session and the resumed SDK session comes back with the server GONE.
  // Stripping is the "MCP server disconnected" bug the whole one-toolset rule
  // exists to prevent (see `delegate-to-spawned-session.ts`: adding is safe,
  // stripping is not); adding it here keeps the set stable across turn origins.
  //
  // Merged rather than folded into the branches above so the pre-existing
  // vynel/plain-vs-interactive delta is left exactly as it was — this change
  // is about the desktop server only. An agent COLLEAGUE is deliberately
  // excluded, matching `DESKTOP_CAPABLE_DELEGATED_TARGETS`.
  const { desktopFeatureDescriptor, deriveDesktopPlanConsent } = await import(
    '@vynel/desktop-control'
  )
  const desktopMcp =
    spawned.scope === 'agent'
      ? null
      : composeSessionMcpServers([desktopFeatureDescriptor], {
          db,
          userId,
          // The action record's task key: Vynel's stable primary id (the SDK id
          // swaps on compaction), plus the session's grounding workspace so the
          // log can be filtered by workspace later.
          sessionId: spawned.id,
          ...(spawned.workspaceId !== null ? { workspaceId: spawned.workspaceId } : {}),
          appRequest: turnSessionAppRequest,
          ...(c.var.desktopNotifications !== undefined
            ? { desktopReader: c.var.desktopNotifications }
            : {}),
          ...(c.var.desktopActionsEnabled !== undefined
            ? { enableDesktopActions: c.var.desktopActionsEnabled }
            : {}),
          // The user IS here on this path — it is them typing into the session
          // — so the turn's own mode decides plan authority, exactly as it does
          // on the global-root chat.
          desktopPlanConsent: deriveDesktopPlanConsent(turnPermissionMode),
        },
        {
          toolPolicies: resolveSessionToolPolicies(db, {
            userId,
            desktopToolNames: desktopFeatureDescriptor.toolNames ?? [],
          }),
          surfaceKind: 'spawned',
        })
  // `desktopMcp` composes to an EMPTY attachment off-Windows (the descriptor
  // self-excludes), so merging it is a no-op there rather than a shape change.
  const backgroundMcp =
    desktopMcp === null || Object.keys(desktopMcp.mcpServers).length === 0
      ? composedBackgroundMcp
      : composedBackgroundMcp === null
        ? desktopMcp
        : mergeComposedSessionMcpServers(composedBackgroundMcp, desktopMcp)

  // Chat-mentions: re-parse the message server-side. @ dispatches ground in
  // the session's OWN ground (reports land at its grounding workspace's chat,
  // or the global root — spawned sessions are leaves and never receive
  // deliveries themselves); # composes the per-turn study descriptor, merged
  // over the background set (or standing alone on a global-grounded session).
  const mentionPlan = await prepareComposerMentionTurn(
    db,
    {
      userId,
      userMessageText: input.userMessageText,
      originWorkspaceId: spawned.workspaceId,
      originWorkspacePath: runCwdPath,
      permissionMode: turnPermissionMode,
      ...(turnSettings.model !== undefined ? { model: turnSettings.model } : {}),
      ...(turnSettings.thinkingEffort !== undefined
        ? { thinkingEffort: turnSettings.thinkingEffort }
        : {}),
    },
    { logger: c.var.logger },
  )
  const studyMcp = mentionPlan?.studyDescriptor
    ? composeSessionMcpServers(
        [mentionPlan.studyDescriptor],
        {
          db,
          userId,
          appRequest: turnSessionAppRequest,
          ...(spawned.workspaceId !== null ? { workspaceId: spawned.workspaceId } : {}),
        },
      )
    : null
  const composedMcp =
    backgroundMcp !== null && studyMcp !== null
      ? mergeComposedSessionMcpServers(backgroundMcp, studyMcp)
      : (backgroundMcp ?? studyMcp)

  const locks = c.var.sessionTargetLocks
  const turnEvents = c.var.turnEvents
  const logger = c.var.logger

  return streamSSE(c, async (stream) => {
    // Single-writer per target (locked decision 3): FIFO-queue behind a
    // running delegated task (or another user turn) on this session. The
    // queued sentinel goes out BEFORE parking so the composer can say
    // "working on a task — queued" instead of looking frozen.
    if (locks.isBusy(spawned.id)) {
      // WHY it waits: this session's own context swap ("patching context") or
      // a running delegated task ("working on a task").
      const reason = isPrimarySwapping(spawned.id) ? 'context-patching' : 'busy'
      await stream.writeSSE({ event: 'turn-queued', data: JSON.stringify({ reason }) })
    }
    const releaseTargetLock = await locks.acquire(spawned.id)
    try {
      // Re-read the chain head AFTER the wait (locked decision 2): the run we
      // queued behind may have compaction-swapped the primary onto a fresh
      // segment — the turn must resume THAT, never the handle's segment.
      const head = findRoutableSessionById(db, { userId, primarySessionId: spawned.id })
      if (head === null || head.currentSdkSessionId === null) {
        // Deleted (or corrupted-unlinked) while we queued — nothing to resume.
        logger.warn(
          { primarySessionId: spawned.id },
          'session turn skipped — the spawned session disappeared while queued',
        )
        await stream.writeSSE({ event: 'turn-stream-ended', data: '{}' })
        return
      }
      const resumeSessionId = head.currentSdkSessionId
      // The head may have moved while we queued — re-stamp before the turn runs.
      turnSession.resolve(resumeSessionId)
      // Settings write-through onto the head: what the composer sent becomes
      // the row's persisted truth. Input-only — omitted fields stay "never set".
      persistTurnSessionSettings(db, resumeSessionId, input, { logger })

      // ONE provider turn on `turnResumeSessionId` — the genuine turn
      // (`continuation` null) or an automatic continuation after a checkpoint
      // (session-continuity §4.6): the short anchor row persists, the model
      // reads the fuller instruction.
      const startOneTurn = (
        turnResumeSessionId: string,
        continuation: ContinuationTurn | null,
      ): AsyncIterable<ChatTurnEvent> =>
        startChatTurn(
          db,
          {
            userId,
            // The session's OWN ground (the delegated-runner parity, 2026-08-17):
            // null for a global-grounded session, its room's id for a
            // workspace-grounded one — so an approval this turn cards files under
            // the room that owns the session, and a mid-turn swap segment stays
            // in that room's list instead of drifting workspace-less. The cwd is
            // a separate fact.
            workspaceId: spawned.workspaceId,
            workspacePath: runCwdPath,
            providerId: DEFAULT_PROVIDER_ID,
            resumeSessionId: turnResumeSessionId,
            // The continuing identity: the boundary continuity step rides the
            // stream (`context-patching` / swap / `context-patched` at pressure)
            // — the same one every delegated turn into this session runs.
            continuity: {
              primarySessionId: spawned.id,
              ...(swapThreshold !== undefined ? { threshold: swapThreshold } : {}),
            },
            userMessageText: continuation?.persistedBody ?? input.userMessageText,
            ...(continuation !== null
              ? {
                  providerUserMessageText: continuation.providerText,
                  messageAttribution: continuation.attribution,
                }
              : {}),
            ...(turnSettings.model !== undefined ? { model: turnSettings.model } : {}),
            ...(turnSettings.thinkingEffort !== undefined
              ? { thinkingEffort: turnSettings.thinkingEffort }
              : {}),
            // The same mode resolution as the workspace chat stream — the user
            // is talking directly, so the interactive default applies (NOT the
            // routed-turn bypass default). Resolved through the session's
            // persisted settings above.
            permissionMode: turnPermissionMode,
            // The system prompt carries ONLY the MCP composer's per-feature
            // sections + the mention-dispatch note — never
            // ROUTED_TASK_INSTRUCTIONS (this is the user, not a routed
            // background task); the session's identity rides its transcript.
            ...(composedMcp !== null
              ? {
                  mcpServers: composedMcp.mcpServers,
                  deniedToolNames: composedMcp.deniedMcpToolPatterns,
                  ...(composedMcp.mutatingToolNames.length > 0
                    ? { alwaysRequireApprovalToolNames: composedMcp.mutatingToolNames }
                    : {}),
                  ...(composedMcp.askModeApprovalToolNames.length > 0
                    ? { askModeApprovalToolNames: composedMcp.askModeApprovalToolNames }
                    : {}),
                }
              : {}),
            ...(() => {
              const sections = [
                composedMcp?.systemPromptAppend ?? '',
                mentionPlan?.systemPromptAppend ?? '',
              ].filter((section) => section !== '')
              return sections.length > 0 ? { systemPromptAppend: sections.join('\n\n') } : {}
            })(),
            // A mid-turn compaction swap keeps the stock hidden presentation —
            // the spawned entry's identity stays its first (listed, named)
            // segment (the delegateToSpawnedSession shape).
            newSessionOptions: {
              visibility: 'hidden',
              title: 'Continued conversation',
              skipAutoTitle: true,
            },
          },
          // turnEvents: the turn tees onto its session channel (Watch everywhere).
          { logger, turnEvents },
        )
      // A continuation resumes the head the checkpoint's boundary swap
      // produced — re-read, the swap moved it (the identity is unchanged).
      const continueOnHead = async function* (
        continuation: ContinuationTurn,
      ): AsyncIterable<ChatTurnEvent> {
        const movedHead = findRoutableSessionById(db, { userId, primarySessionId: spawned.id })
        if (movedHead === null || movedHead.currentSdkSessionId === null) {
          logger.warn(
            { primarySessionId: spawned.id },
            'session continuation skipped — the spawned session disappeared after its checkpoint',
          )
          return
        }
        yield* startOneTurn(movedHead.currentSdkSessionId, continuation)
      }
      // The genuine turn, then — only when the model checkpointed — its
      // automatic continuations, all on this one SSE stream ("patching →
      // continuing").
      const turnStream = runTurnWithContinuations({
        primarySessionId: spawned.id,
        runTurn: (continuation) =>
          continuation === null
            ? startOneTurn(resumeSessionId, null)
            : continueOnHead(continuation),
        logger,
      })

      // Announce on the liveness feed — a spawned session is global-scoped on
      // the feed (the delegation tick's session-target shape); an agent
      // colleague announces under its GROUNDING workspace (the agent-run
      // parity), origin 'web'. Begun immediately before the try (zombie-turn
      // doctrine).
      const activity = c.var.activityFeed.begin({
        userId,
        ...(spawned.scope === 'agent' && spawned.workspaceId !== null
          ? { scopeKind: 'workspace' as const, workspaceId: spawned.workspaceId }
          : { scopeKind: 'global' as const }),
        sessionId: resumeSessionId,
        origin: 'web',
        // The continuing identity (persona-sessions) — the live views key a
        // direct-send turn to the same session card a delegated run uses.
        primarySessionId: spawned.id,
      })
      // 'failed' when the drain sees a terminal session-errored or throws.
      let turnOutcome: 'ended' | 'failed' = 'ended'
      try {
        for await (const event of turnStream) {
          if (event.kind === 'session-errored' && !event.isRecoverable) turnOutcome = 'failed'
          if (event.kind === 'session-created') {
            // Mid-turn compaction swap — advance the primary's link so the
            // NEXT turn resumes the new head (event-driven, the
            // delegateToSpawnedSession shape).
            linkPrimarySessionToSdkSession(db, {
              primarySessionId: spawned.id,
              userId,
              sdkSessionId: event.session.id,
            })
            activity.sessionResolved(event.session.id)
            turnSession.resolve(event.session.id)
            mentionPlan?.onSessionResolved(event.session.id)
          } else if (event.kind === 'user-message-persisted') {
            activity.sessionResolved(event.message.sessionId)
            turnSession.resolve(event.message.sessionId)
            mentionPlan?.onSessionResolved(event.message.sessionId)
          }
          await stream.writeSSE({ event: event.kind, data: JSON.stringify(event) })
        }
      } catch (err) {
        // A mid-stream throw must still reach the client as typed frames — a
        // bare socket close leaves the composer "working" forever.
        turnOutcome = 'failed'
        logger.error({ err }, 'session turn stream failed mid-flight')
        await writeSseSafely(
          stream,
          'session-errored',
          JSON.stringify({
            kind: 'session-errored',
            sessionId: resumeSessionId,
            errorCode: 'turn-stream-failed',
            errorMessage: err instanceof Error ? err.message : String(err),
            isRecoverable: false,
          }),
          logger,
        )
      } finally {
        // The terminal frame fires on EVERY exit (clean, thrown, disconnect).
        await writeSseSafely(stream, 'turn-stream-ended', '{}', logger)
        // Fires even on client disconnect (generator cleanup). Best-effort.
        activity.end(turnOutcome)
      }
    } finally {
      // The single-writer hand-over: a queued delegated job (or user turn) on
      // this session may claim the moment this releases. Idempotent. WHY here,
      // unconditionally: a client that DISCONNECTS while parked does not
      // cancel the waiter — on release it still resumes and runs the turn TO
      // COMPLETION (intentional: the client saw `turn-queued`, i.e. "will be
      // delivered", so the message and its reply persist onto the session
      // while the dead stream's writes silently no-op — hono's abort flips
      // write into a no-op, it never throws). Every exit — clean drain, a
      // teardown throw, the vanished-target return — MUST pass through this
      // release, or the target key leaks and the session is silently
      // unwritable forever. Pinned in session-turn.test.ts.
      releaseTargetLock()
    }
  })
}
