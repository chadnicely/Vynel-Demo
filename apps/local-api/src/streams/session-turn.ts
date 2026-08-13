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

import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { z } from 'zod'
import { NotFoundError } from '@vynel/errors'
import { startChatTurn } from '@vynel/session/runtime'
import { toPermissionMode, DEFAULT_SESSION_MODE } from '@vynel/session'
import { linkPrimarySessionToSdkSession } from '@vynel/session/continuity'
import { findRoutableSessionBySegmentId, findRoutableSessionById } from '@vynel/session/spawned'
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
          })
        : null

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
          desktopPlanConsent: deriveDesktopPlanConsent(
            toPermissionMode(input.mode ?? DEFAULT_SESSION_MODE),
          ),
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
      permissionMode: toPermissionMode(input.mode ?? DEFAULT_SESSION_MODE),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}),
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
      await stream.writeSSE({ event: 'turn-queued', data: '{}' })
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

      const turnStream = startChatTurn(
        db,
        {
          userId,
          // Workspace-less rows, the delegated-spawned-runner parity — the
          // session's ground rides the cwd, not the row scope.
          workspaceId: null,
          workspacePath: runCwdPath,
          providerId: DEFAULT_PROVIDER_ID,
          resumeSessionId,
          userMessageText: input.userMessageText,
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.thinkingEffort !== undefined
            ? { thinkingEffort: input.thinkingEffort }
            : {}),
          // The same mode resolution as the workspace chat stream — the user
          // is talking directly, so the interactive default applies (NOT the
          // routed-turn bypass default).
          permissionMode: toPermissionMode(input.mode ?? DEFAULT_SESSION_MODE),
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
      try {
        for await (const event of turnStream) {
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
        activity.end()
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
