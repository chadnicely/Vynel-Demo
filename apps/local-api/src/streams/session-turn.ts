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
import { findSpawnedSessionBySegmentId, findSpawnedSessionById } from '@vynel/session/spawned'
import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import type { AppEnv } from '../factory.js'
import { buildWorkspaceBackgroundMcpComposer } from '../sessions/build-workspace-background-mcp.js'
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

  // Resolve the spawned primary from the tool/UI handle — the CURRENT segment
  // id `list_sessions`/`create_session` hand out and the Sessions overview
  // lists as the entry's sessionId. Unknown, foreign, and non-spawned all 404
  // identically (no enumeration leak). By construction the handle IS the
  // linked head, so an unlinked primary can never resolve here.
  const spawned = findSpawnedSessionBySegmentId(db, { userId, sessionId })
  if (spawned === null) {
    throw new NotFoundError('session', sessionId)
  }

  // The session's ground (locked decision 1): its workspace's folder + the
  // PLAIN background set for a workspace-grounded session — byte-for-byte what
  // its delegated turns attach — or the hidden global-root cwd + nothing for a
  // global-grounded one (its delegated turns run bare too).
  const runCwdPath = resolveSpawnedSessionRunCwd(db, spawned)
  const composedMcp =
    spawned.workspaceId !== null
      ? (await buildWorkspaceBackgroundMcpComposer(c.var.appRequest))({
          db,
          userId,
          workspaceId: spawned.workspaceId,
        })
      : null

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
      const head = findSpawnedSessionById(db, { userId, primarySessionId: spawned.id })
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
          // sections — never ROUTED_TASK_INSTRUCTIONS (this is the user, not a
          // routed background task); the session's identity rides its transcript.
          ...(composedMcp !== null
            ? {
                mcpServers: composedMcp.mcpServers,
                allowedMcpToolPatterns: composedMcp.allowedMcpToolPatterns,
                deniedToolNames: composedMcp.deniedMcpToolPatterns,
                ...(composedMcp.systemPromptAppend !== ''
                  ? { systemPromptAppend: composedMcp.systemPromptAppend }
                  : {}),
                ...(composedMcp.mutatingToolNames.length > 0
                  ? { alwaysRequireApprovalToolNames: composedMcp.mutatingToolNames }
                  : {}),
                ...(composedMcp.askModeApprovalToolNames.length > 0
                  ? { askModeApprovalToolNames: composedMcp.askModeApprovalToolNames }
                  : {}),
              }
            : {}),
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
      // the feed (the delegation tick's session-target shape), origin 'web'.
      // Begun immediately before the try (zombie-turn doctrine).
      const activity = c.var.activityFeed.begin({
        userId,
        scopeKind: 'global',
        sessionId: resumeSessionId,
        origin: 'web',
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
          } else if (event.kind === 'user-message-persisted') {
            activity.sessionResolved(event.message.sessionId)
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
