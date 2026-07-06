// `delegateToWorkspaceRoot` — the apps/local-api composition for routing a task INTO a
// workspace's CONTINUING PRIMARY conversation (brain-tree Phase 1). Resumes the
// workspace's OWN brain (its primary session, with its context), so "hey jarvis, in
// Acme, summarize the notes" reaches Acme's actual conversation.
//
// THE ROUTED TURN RUNS THROUGH THE ONE SHARED PIPELINE (`consumeSessionEventStream`)
// — the same path every other turn type uses — so everything persists LIVE: the task
// row lands at session-started (attributed "From Global" + the trace key), the reply
// grows chunk-by-chunk, TOOL CALLS and thinking persist as they happen. The workspace
// chat and the Watch panel read it in realtime; nothing waits for completion. (The
// old raw drain + flat completion rows — `recordDelegatedRootMessages` — are gone.)
//
// APPROVALS (surface-up): the pipeline RECORDS each card (workspace-scoped, rules
// evaluated) and parks; the injected handler surfaces it (origin channel + wait
// gate). The denial circuit-breaker lives in the consume loop here: two denied
// decisions in one turn interrupt the leaf (retry-loop guard), ending with the
// clean blocked note.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import type { AiAgentProvider, AiAgentProviderId } from '@vynel/providers'
import {
  recordDelegation,
  ROUTED_LEAF_MAX_CARDED_DENIALS,
  ROUTED_LEAF_WRITE_BLOCKED_NOTE,
  type DelegationPermissionMode,
} from '@vynel/orchestration'
import { consumeSessionEventStream, composeManagerSourceLabel } from '@vynel/chat'
import { linkPrimarySessionToSdkSession } from '@vynel/session/continuity'
import { resolvePrimaryConversationTarget } from '@vynel/session/runtime'
import type { Logger } from 'pino'
import type { RoutedApprovalHandler } from './build-routed-approval-handler.js'

// How a routed (background) turn should behave — appended to the SYSTEM prompt, never
// the task text (the task persists verbatim to the transcript). Steers the model to
// read-only tools for read tasks and sets expectations for the approval pause.
export const ROUTED_TASK_INSTRUCTIONS =
  'This task was routed from the user’s assistant and runs in the background. Prefer ' +
  'read-only tools (Read, Glob, Grep, LS) for read/analysis tasks. An irreversible action ' +
  '(write, edit, delete, shell command) PAUSES until the user approves it from their app or ' +
  'chat — use one only when the task genuinely needs it, and if it is denied or times ' +
  'out, report your findings as text instead of retrying.'

export type DelegateToWorkspaceRootInput = {
  /** The delegating (parent) session — the global root's current SDK session id. */
  parentSessionId: string
  userId: string
  /** The workspace whose ROOT brain handles the task. */
  workspaceId: string
  /** The workspace folder on disk — the root's cwd. */
  workspacePath: string
  /** The workspace name — the reply attribution's `sourceLabel` base. */
  workspaceName: string
  /** The workspace manager's persona name (brain-tree Ch5) — composes "Mark · vynel".
   *  Absent → just the workspace name. */
  managerName?: string
  /** The task the global root delegates. */
  taskText: string
  /** The provider id stamped on the persisted rows. */
  providerId: AiAgentProviderId
  /** Optional model override for the delegated turn. */
  model?: string
  /** The delegation request's correlation key (brain-tree Chapter 2) — stamped on
   *  every row the turn persists so the chain is queryable as one trace. */
  partialSessionId?: string
  /** The permission mode the routed turn runs under (surface-up step 1) — from the
   *  job row. Omit for the pre-mode default (`bypass-with-behavior-gate`). */
  permissionMode?: DelegationPermissionMode
  /** The surface-up handler (the tick's `buildRoutedApprovalHandler`): channel push +
   *  wait-gate edges. Recording happens inside the pipeline either way — without a
   *  handler a carded tool still parks on the recorded card, bounded by the approvals
   *  reaper (no instant auto-deny; production always injects). */
  approvalHandler?: Pick<RoutedApprovalHandler, 'onApprovalRequested' | 'onApprovalResolved'>
  logger?: Logger
}

export type DelegateToWorkspaceRootResult = {
  /** The workspace root's session reference (its SDK session id). */
  reference: string
  /** The workspace root's clean answer — what the global root absorbs. */
  resultText: string
}

export async function delegateToWorkspaceRoot(
  db: Database,
  provider: AiAgentProvider,
  input: DelegateToWorkspaceRootInput,
): Promise<DelegateToWorkspaceRootResult> {
  // 1. Resolve the workspace's continuing primary + the SDK session to resume.
  const target = await resolvePrimaryConversationTarget(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  })

  // 2. Start the provider turn — resume the workspace's brain, or fresh on first use.
  const sessionEventStream = provider.startChatSession({
    workspacePath: input.workspacePath,
    ...(target.resumeSdkSessionId !== null
      ? { resumeSessionId: target.resumeSdkSessionId }
      : {}),
    userMessageText: input.taskText,
    systemPromptAppend: ROUTED_TASK_INSTRUCTIONS,
    permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate',
    // Empty grants: a resumed root keeps the workspace's existing tool grants; a
    // fresh root gets the SDK defaults. The behavior gate still cards the floor.
    allowedToolNames: [],
    deniedToolNames: [],
    ...(input.model !== undefined ? { model: input.model } : {}),
  })

  // 3. Consume through the shared pipeline — every row persists as it streams,
  //    attributed like the old completion rows were (task "From Global", replies
  //    as the workspace manager, everything trace-keyed).
  const turnStream = consumeSessionEventStream({
    db,
    sessionEventStream,
    userMessageInput: { id: randomUUID(), body: input.taskText, attachedImagesMetadata: null },
    userId: input.userId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    providerId: input.providerId,
    isNewSession: target.resumeSdkSessionId === null,
    // The routed segment keeps the swap-segment presentation (the old
    // recordSwapSegmentSession shape): hidden from the curated sidebar — the
    // continuing brain shows as ONE entry — and never auto-titled (it is the
    // primary thread, not a user-named conversation).
    newSessionOptions: { visibility: 'hidden', title: 'Continued conversation', skipAutoTitle: true },
    messageAttribution: {
      ...(input.partialSessionId !== undefined
        ? { partialSessionId: input.partialSessionId }
        : {}),
      userSourceKind: 'global-root',
      assistantSourceKind: 'workspace-manager',
      assistantSourceLabel: composeManagerSourceLabel(input.workspaceName, input.managerName),
    },
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  })

  // 4. Drive the stream: link the primary on a new/swapped segment, accumulate the
  //    clean result, surface approvals, and trip the denial breaker.
  let sessionId: string | null = null
  let resultText = ''
  let cardedDenials = 0
  let trippedBreaker = false
  let streamError: { code: string; message: string } | null = null

  try {
    for await (const event of turnStream) {
      switch (event.kind) {
        case 'user-message-persisted':
          // Fires on BOTH the new and resumed branches — every turn sets it.
          sessionId = event.message.sessionId
          break
        case 'session-created':
          // A fresh root OR a compaction swap — advance the primary's link so the
          // next delegation resumes THIS segment (the P0.1 id-based gate, now
          // event-driven like the global-root core).
          linkPrimarySessionToSdkSession(db, {
            primarySessionId: target.primarySessionId,
            userId: input.userId,
            sdkSessionId: event.session.id,
          })
          break
        case 'text-chunk':
          resultText += event.textDelta
          break
        case 'approval-requested':
          input.approvalHandler?.onApprovalRequested(event)
          break
        case 'approval-resolved': {
          input.approvalHandler?.onApprovalResolved(event)
          // Breaker on DENIALS (user, reaper, or fallback): the leaf keeps proposing
          // irreversible actions past the denials — interrupt it ONCE so it fails
          // fast instead of burning the route timeout. Approvals never count.
          if (event.decision.kind === 'denied') {
            cardedDenials += 1
            if (
              !trippedBreaker &&
              sessionId !== null &&
              cardedDenials >= ROUTED_LEAF_MAX_CARDED_DENIALS
            ) {
              trippedBreaker = true
              await provider.interruptChatSession(sessionId)
            }
          }
          break
        }
        case 'session-errored':
          streamError = { code: event.errorCode, message: event.errorMessage }
          break
        default:
          break // tool/thinking/usage/title events persist inside the pipeline
      }
    }
  } catch (err) {
    // The pipeline threw mid-turn (e.g. an approval record failed before it could be
    // yielded/parked). Fail CLOSED: interrupt the leaf session so the provider cancels
    // any pending canUseTool Promise — never a background agent parked on a card no
    // surface can see. Best-effort; the rethrow carries the real failure.
    if (sessionId !== null) {
      try {
        await provider.interruptChatSession(sessionId)
      } catch (interruptErr) {
        input.logger?.warn(
          { err: interruptErr, sessionId },
          'delegateToWorkspaceRoot: interrupt-on-throw failed (the reaper bounds recorded cards)',
        )
      }
    }
    throw err
  }

  if (sessionId === null) {
    // A provider that dies BEFORE session-started surfaces here — the pipeline only
    // emits `session-errored` once a session exists (its contract), so the id is all
    // we can report.
    throw new Error(
      'delegateToWorkspaceRoot: the runtime did not assign a session id for the routed turn',
    )
  }
  if (streamError !== null) {
    throw new Error(
      `delegateToWorkspaceRoot: the routed turn errored (${streamError.code}): ${streamError.message}`,
    )
  }

  // 5. The parent→child tree edge (global root → workspace root) for the monitor.
  recordDelegation(db, {
    parentSessionId: input.parentSessionId,
    childSessionId: sessionId,
    role: 'workspace-root',
    userId: input.userId,
  })

  // Tripped the breaker → end with the clean blocked note, preserving any text the
  // leaf produced (never an empty result the root can't relay).
  const cleaned = resultText.trim()
  if (trippedBreaker) {
    return {
      reference: sessionId,
      resultText: cleaned === '' ? ROUTED_LEAF_WRITE_BLOCKED_NOTE : `${cleaned}\n\n${ROUTED_LEAF_WRITE_BLOCKED_NOTE}`,
    }
  }
  return { reference: sessionId, resultText: cleaned }
}
