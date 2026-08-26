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
//   5. A VOICE turn (`input.voice` — the live-call leg, session-hardening D2)
//      runs the voice tier forced over the body, reads and writes no settings,
//      and fit-clamps the pin — the same gates the global stream applies, so
//      a per-call session born with NULL settings can never fall to a carding
//      mode on a surface with no card renderer.
//   6. The turn is BOUNDED (D5): the interactive wall clock runs while this
//      turn holds the target lock, suspended while a card is parked, and cuts
//      the turn off honestly (interrupt + failure row) at
//      `VYNEL_INTERACTIVE_TURN_MAX_MS`.
//   7. A VOICE turn also loses the `speak` tool (voice-realtime VR1): the
//      streamed TEXT is what the caller hears. The rule + its WHY live in
//      `sessions/voice-thread-tools.ts`, and it is applied here unconditionally
//      — today's call session composes no `vynel` server only because it is
//      spawned + global-grounded, which is grounding, not policy.
//
// The VOICE CLIENT CONTRACT on this leg (the sibling of the one documented in
// `global-root-turn.ts`, with one asymmetry the daemon must know about).
// A call client SPEAKS this stream's `text-chunk` deltas as they arrive, and
// learns the turn's session id from the same frames the wake leg uses, in the
// same guaranteed order: `user-message-persisted` (`message.sessionId`) is
// written before the provider starts on a resumed turn, `session-created`
// (`session.id`) lands on a fresh segment, and a mid-turn compaction swap
// re-issues both — keep the LATEST. NOTE the asymmetry with the wake leg: a
// per-call session is scope 'spawned', which `POST /root/turn/interrupt`
// deliberately refuses (it admits global + voice chains only) and the workspace
// door cannot reach either (the session is global-grounded). So a call barge-in
// cuts local playback today and has NO server-side interrupt; a spawned-session
// stop door is a product call, not something to widen this route into.

import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { z } from 'zod'
import { NotFoundError } from '@vynel/errors'
import {
  startChatTurn,
  runContinuingTurn,
  startTurnWallClock,
  trackApprovalParks,
  failTurnOnWallClock,
  LockWaitAbandonedError,
  type ContinuationTurn,
} from '@vynel/session/runtime'
import { ApprovalWaitGate } from '@vynel/orchestration'
import { isPrimarySwapping, linkPrimarySessionToSdkSession } from '@vynel/session/continuity'
import { findRoutableSessionBySegmentId, findRoutableSessionById } from '@vynel/session/spawned'
import { composeAgentColleaguePrompt, resolveColleagueAgent } from '@vynel/session/delegation'
import { composeSessionInstruction } from '@vynel/instructions/session-instructions'
import { persistTurnSessionSettings, type ChatTurnEvent } from '@vynel/chat'
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
import { withVoiceThreadToolDenials } from '../sessions/voice-thread-tools.js'
import { createTurnSessionCarrier } from '../sessions/turn-session-header.js'
import { wrapAppRequestWithMode } from '../sessions/delegation-mode-header.js'
import { resolveSpawnedSessionRunCwd } from '../sessions/spawned-session-ground.js'
import { writeSseSafely } from './write-sse-safely.js'
import { buildTurnLockWait, requestAbortSignal, writeLockWaitGiveUp } from './turn-queue-wait.js'
import { resolveInteractiveTurnSettings } from './interactive-turn-settings.js'
import { loadEnv, resolveLockWaitMaxMs } from '../env.js'
import { resolveDesktopActionsEnabled } from '../sessions/resolve-desktop-actions-enabled.js'
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
  const env = loadEnv()
  const swapThreshold = env.VYNEL_CONTEXT_PRESSURE_THRESHOLD
  // Per-session settings resolution (one home: `resolveInteractiveTurnSettings`):
  // a keyboard turn = explicit input ?? the session's persisted setting ?? the
  // default; a VOICE turn = the voice tier, forced, no row read. Read off the
  // HANDLE segment pre-lock — settings are swap-stable (copied forward onto
  // fresh segments), so the post-wait head carries the same values; the voice
  // fit clamp against the handle is at worst conservative for one turn.
  const isVoiceTurn = input.voice === true
  const turnSettings = resolveInteractiveTurnSettings(
    db,
    input,
    { sessionId, ...(swapThreshold !== undefined ? { pressureThreshold: swapThreshold } : {}) },
    { logger: c.var.logger },
  )
  const turnPermissionMode = turnSettings.permissionMode
  // The turn's own session identity — the segment it resumes (re-resolved
  // after the queue wait below, and again on a mid-turn compaction swap). The
  // dock the user has open on this thread is keyed by that same segment id.
  const turnSession = createTurnSessionCarrier(sessionId)
  // The turn's RESOLVED mode rides every routing request its tools make (the
  // chat-turn/global-root rule), unconditionally — the default included — so
  // a child this turn enqueues runs the mode its parent ran, provably. Stamping
  // only a resolved mode left a mode-less parent's children on NULL → the
  // runner's own default: parent and child could disagree (audit A6).
  const turnSessionAppRequest = turnSession.wrapAppRequest(
    wrapAppRequestWithMode(c.var.appRequest, turnPermissionMode),
  )
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
          // Resolved PER TURN (Settings → Desktop control) — always a
          // boolean, so no conditional spread is needed here.
          enableDesktopActions: resolveDesktopActionsEnabled(db, userId),
          // The user IS here on this path — typing into the session, or
          // speaking on a live call — so the turn's own mode decides plan
          // authority, exactly as it does on the global-root chat.
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
      // The RESOLVED model — a voice turn's fitted tier, never an unfitted pin
      // (the turn and its dispatches run the same model).
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
  const composedTurnMcp =
    backgroundMcp !== null && studyMcp !== null
      ? mergeComposedSessionMcpServers(backgroundMcp, studyMcp)
      : (backgroundMcp ?? studyMcp)
  // The spoken thread's own rule, applied ONCE over the merged attachment
  // (locked decision 7): a call turn's streamed text is what the caller hears,
  // so `speak` is denied for it — a keyboard turn into the same session keeps it.
  const composedMcp =
    isVoiceTurn && composedTurnMcp !== null
      ? withVoiceThreadToolDenials(composedTurnMcp)
      : composedTurnMcp

  // The identity stack (base + kind) rides the DIRECT turn too — the same
  // stack this session's delegated turns carry, so it never speaks with two
  // identities depending on which door the turn came through. An agent
  // colleague keeps its persona on EVERY turn (persona-sessions) — before
  // this, a user typing at a colleague got NO persona at all; a colleague
  // whose agent row is gone (uninstalled while the conversation lingers)
  // falls back to the child identity rather than failing the user's turn.
  const colleagueAgent =
    spawned.scope === 'agent' && spawned.scopeRef !== null
      ? await resolveColleagueAgent(db, {
          userId,
          workspaceId: spawned.workspaceId,
          slug: spawned.scopeRef,
        })
      : null
  const identityAppend =
    colleagueAgent !== null
      ? composeAgentColleaguePrompt(colleagueAgent.name, colleagueAgent.prompt, {
          voice: isVoiceTurn,
        })
      : composeSessionInstruction('spawned-session', { voice: isVoiceTurn })

  const locks = c.var.sessionTargetLocks
  const turnEvents = c.var.turnEvents
  const logger = c.var.logger

  return streamSSE(c, async (stream) => {
    // Single-writer per target (locked decision 3): FIFO-queue behind a
    // running delegated task (or another user turn) on this session. The
    // queued sentinel, the queue's bound and its cancel are one home (R2-J):
    // the lock announces the moment this turn parks and keeps re-announcing
    // while it waits, gives up past the budget, and drops the waiter when the
    // client goes away. WHY it waits is resolved per frame: this session's own
    // context swap ("patching context") or a running task ("working on a task").
    let releaseTargetLock: () => void
    try {
      releaseTargetLock = await locks.acquire(
        spawned.id,
        buildTurnLockWait({
          stream,
          requestSignal: requestAbortSignal(c),
          maxWaitMs: resolveLockWaitMaxMs(env),
          resolveReason: () => (isPrimarySwapping(spawned.id) ? 'context-patching' : 'busy'),
          logger,
        }),
      )
    } catch (err) {
      // The turn never started — no feed handle, no wall clock, nothing to
      // release. Only the client needs its honest ending.
      const gaveUpQueued = await writeLockWaitGiveUp(stream, err, { sessionId: null, logger })
      // Anything that is NOT a queue give-up is the acquire itself failing, and
      // it gets the SAME ending a mid-flight throw gets (the catch below the
      // drain): logged + a typed frame. Without this the error vanished — no
      // log, no frame, just a `turn-stream-ended` that reads as a clean turn.
      // The two give-up paths are untouched: expiry wrote its own frame above,
      // and a disconnected client has nobody left to read one.
      if (!gaveUpQueued && !(err instanceof LockWaitAbandonedError)) {
        logger.error({ err }, 'session turn stream failed before the lock was acquired')
        await writeSseSafely(
          stream,
          'session-errored',
          JSON.stringify({
            kind: 'session-errored',
            sessionId: '',
            errorCode: 'turn-stream-failed',
            errorMessage: err instanceof Error ? err.message : String(err),
            isRecoverable: false,
          }),
          logger,
        )
      }
      await writeSseSafely(stream, 'turn-stream-ended', '{}', logger)
      return
    }
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
      // NEVER for a voice turn: the tier's pins are the surface's, not the
      // user's chips (the voice no-write rule, both legs).
      if (!isVoiceTurn) persistTurnSessionSettings(db, resumeSessionId, input, { logger })

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
              // Inside `runContinuingTurn` — the runner picks a pending
              // checkpoint up after this turn, so the restart-survivor marker
              // may promise it (audit r2 R2-H).
              autoContinues: true,
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
            // Autopilot (D8) — the resolved Auto-buildout rides the turn; the
            // runner appends the marker when true.
            ...(turnSettings.autoBuildout !== undefined
              ? { autoBuildout: turnSettings.autoBuildout }
              : {}),
            // The same mode resolution as the workspace chat stream — the user
            // is talking directly (typing, or speaking on a call: the voice
            // tier's mode), resolved through the session's persisted settings
            // above; never the routed-turn default.
            permissionMode: turnPermissionMode,
            // The system prompt opens with the identity stack (base + kind;
            // a colleague's persona included), then the MCP composer's
            // per-feature sections + the mention-dispatch note — never
            // ROUTED_TASK_INSTRUCTIONS (this is the user, not a routed
            // background task).
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
                identityAppend,
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
      // The genuine turn, then — only when the model checkpointed — its
      // automatic continuations, all on this one SSE stream ("patching →
      // continuing"); a continuation resumes the head its swap produced
      // (re-read — a spawned session deleted meanwhile skips it, logged).
      const turnStream = runContinuingTurn({
        db,
        primarySessionId: spawned.id,
        resumeSessionId,
        resolveHead: async () =>
          findRoutableSessionById(db, { userId, primarySessionId: spawned.id })
            ?.currentSdkSessionId ?? undefined,
        startOneTurn: (headSessionId, continuation) =>
          // A DM turn always has a head to resume — the vanished case is the
          // helper's skip, never a fresh conversation.
          startOneTurn(headSessionId ?? resumeSessionId, continuation),
        logger,
      })

      // 'failed' when the drain sees a terminal session-errored, throws, or the
      // wall clock cuts the turn off.
      let turnOutcome: 'ended' | 'failed' = 'ended'
      // The interactive wall clock (D5) — armed now that this turn HOLDS the
      // target lock (queue time was the holder's budget), suspended while a
      // card is parked (this stream attaches no ask_user), cleared in the
      // finally. Expiry: the honest failure row + an interrupt of the head the
      // turn is on (`turnSession.current()` follows a mid-turn swap), so the
      // provider ends the stream and the lock releases through the finally.
      const waitGate = new ApprovalWaitGate()
      const approvalParks = trackApprovalParks(waitGate)
      const wallClock = startTurnWallClock({
        maxMs: env.VYNEL_INTERACTIVE_TURN_MAX_MS,
        waitGate,
        logger,
        onExpire: async () => {
          turnOutcome = 'failed'
          const failure = await failTurnOnWallClock(
            { db, logger },
            { sessionId: turnSession.current(), maxMs: env.VYNEL_INTERACTIVE_TURN_MAX_MS },
          )
          await writeSseSafely(
            stream,
            'session-errored',
            JSON.stringify({
              kind: 'session-errored',
              sessionId: turnSession.current() ?? resumeSessionId,
              ...failure,
              isRecoverable: false,
            }),
            logger,
          )
        },
      })
      // Announce on the liveness feed under the session's GROUNDING: a child
      // spawned inside a room (a spawned session or an agent colleague) works
      // IN that room, and the room must read "working" for it — the same
      // frame the delegated door (`run-task-job`) announces, so the two doors
      // into one child never disagree about where it lives. It still names
      // its own primary, so a workspace chat never binds to it as the room's
      // thread. A global-grounded child announces in the global area. Origin
      // 'voice' for the live-call leg, else 'web'. Begun immediately before
      // the try (zombie-turn doctrine).
      const activity = c.var.activityFeed.begin({
        userId,
        ...(spawned.workspaceId !== null
          ? { scopeKind: 'workspace' as const, workspaceId: spawned.workspaceId }
          : { scopeKind: 'global' as const }),
        sessionId: resumeSessionId,
        origin: isVoiceTurn ? 'voice' : 'web',
        // The continuing identity (persona-sessions) — the live views key a
        // direct-send turn to the same session card a delegated run uses.
        primarySessionId: spawned.id,
      })
      try {
        for await (const event of turnStream) {
          if (event.kind === 'session-errored' && !event.isRecoverable) turnOutcome = 'failed'
          // A parked card suspends the wall clock; its decision resumes it.
          approvalParks.onTurnEvent(event)
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
        wallClock.clear()
        // The terminal frame fires on EVERY exit (clean, thrown, disconnect).
        await writeSseSafely(stream, 'turn-stream-ended', '{}', logger)
        // Fires even on client disconnect (generator cleanup). Best-effort.
        activity.end(turnOutcome)
      }
    } finally {
      // The single-writer hand-over: a queued delegated job (or user turn) on
      // this session may claim the moment this releases. Idempotent. Every exit
      // — clean drain, a teardown throw, the vanished-target return — MUST pass
      // through this release, or the target key leaks and the session is
      // silently unwritable forever. Pinned in session-turn.test.ts.
      //
      // A client that disconnects while PARKED no longer reaches here at all:
      // its waiter leaves the queue and the turn never starts (audit R2-J,
      // reversing the earlier "the client saw `turn-queued`, so deliver it
      // anyway" rule — a turn run for nobody still holds the single-writer key
      // and burns a provider session). Once the turn IS running, a disconnect
      // still lets it finish: its writes no-op, its rows persist.
      releaseTargetLock()
    }
  })
}
