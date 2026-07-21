// Handler for the `session-started` variant of the session-event
// stream. Extracted from `consume-session-event-stream.ts` per
// structure-standard.md "File size cap" (audit 2026-05-27).
//
// The new-session branch co-commits the chat-session row + the
// user-message row + the outbox event in one sync transaction
// (Phase 1 sync-tx discipline — better-sqlite3 rejects async
// callbacks). The resumed-session branch wraps the user-message
// insert + lastMessageAt bump in one transaction so failure
// doesn't leave a message attached to a session with a stale
// `lastMessageAt` (chat Gate 3 finding S4 2026-05-23).

import * as chatRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { withTransaction, type Database } from '@vynel/db'
import type { ChatMessage } from '../repositories/index.js'
import type { AiAgentProviderId, NormalizedSessionEvent } from '@vynel/providers'
import { CHAT_SESSION_CREATED } from '../chat-events.js'
import { buildNewChatSessionRow } from './build-new-chat-session-row.js'
import type { ChatTurnEvent } from '../chat-turn-event.js'
import type { NewSessionOptions } from '../chat-types.js'
import type {
  UserMessageInput,
  TurnMessageAttribution,
} from './consume-session-event-stream.js'

export type HandleSessionStartedInput = {
  db: Database
  event: Extract<NormalizedSessionEvent, { kind: 'session-started' }>
  userMessageInput: UserMessageInput
  userId: string
  /** Null for a global-root (brain) session — `buildNewChatSessionRow` derives
   *  `scope: 'global'` from it, and the co-committed outbox payload carries null. */
  workspaceId: string | null
  providerId: AiAgentProviderId
  isNewSession: boolean
  /** Presentation overrides for the new-session row (the brain passes hidden +
   *  'Global brain'). Omitted by the workspace path → defaults. */
  newSessionOptions?: NewSessionOptions
  /** Stamped on the user row (surface-up routed turns): the task's origin
   *  ('global-root') + the delegation trace key. Omitted → nulls (unchanged). */
  messageAttribution?: TurnMessageAttribution
}

export type HandleSessionStartedResult = {
  sessionId: string
  userMessage: ChatMessage
  events: ChatTurnEvent[]
}

export function handleSessionStarted(input: HandleSessionStartedInput): HandleSessionStartedResult {
  const {
    db,
    event,
    userMessageInput,
    userId,
    workspaceId,
    providerId,
    isNewSession,
    newSessionOptions,
    messageAttribution,
  } = input
  const userRowAttribution = {
    sourceKind: messageAttribution?.userSourceKind ?? null,
    sourceLabel: messageAttribution?.userSourceLabel ?? null,
    partialSessionId: messageAttribution?.partialSessionId ?? null,
  }
  const sessionId = event.sessionId
  const now = event.startedAt
  const events: ChatTurnEvent[] = []
  let userMessage: ChatMessage

  // Create the session row when the caller says it's new OR the row doesn't exist
  // yet — a resumed turn whose SDK session id swapped (compaction) reports a new id
  // with no row; without this the user-message insert below would FK-fail. Additive:
  // preserves isNewSession's decision in every case that works today, only ADDS
  // creation in the previously-failing swap case.
  if (isNewSession || chatRepository.findChatSessionById(db, sessionId) === null) {
    userMessage = withTransaction(db, (tx) => {
      // initialMessageCount: 1 — the user message is co-committed below.
      chatRepository.insertChatSession(
        tx,
        buildNewChatSessionRow({
          sessionId,
          userId,
          workspaceId,
          providerId,
          startedAt: now,
          initialMessageCount: 1,
          ...(newSessionOptions?.visibility !== undefined
            ? { visibility: newSessionOptions.visibility }
            : {}),
          ...(newSessionOptions?.title !== undefined ? { title: newSessionOptions.title } : {}),
        }),
      )
      const inserted = chatRepository.insertChatMessage(tx, {
        id: userMessageInput.id,
        sessionId,
        role: 'user',
        body: userMessageInput.body,
        sourceKind: userRowAttribution.sourceKind,
        sourceLabel: userRowAttribution.sourceLabel,
        partialSessionId: userRowAttribution.partialSessionId,
        originChannel: userMessageInput.originChannel ?? null,
        thinkingBody: null,
        inputTokens: null,
        outputTokens: null,
        attachedImagesMetadata: userMessageInput.attachedImagesMetadata,
        errorCode: null,
        errorMessage: null,
        startedAt: now,
        completedAt: now, // user messages are "complete" immediately
        createdAt: now,
      })
      insertOutboxEvent(tx, {
        id: crypto.randomUUID(),
        type: CHAT_SESSION_CREATED,
        payload: { userId, workspaceId, sessionId, providerId },
        createdAt: new Date(),
        processedAt: null,
      })
      return inserted
    })

    events.push({ kind: 'user-message-persisted', message: userMessage })
    const newSession = chatRepository.findChatSessionById(db, sessionId)
    if (newSession) events.push({ kind: 'session-created', session: newSession })
  } else {
    // Resumed session: session row already exists. Wrap the user-message
    // insert + lastMessageAt bump in one transaction so a failure doesn't
    // leave a message attached to a session with a stale lastMessageAt
    // (chat Gate 3 S4 2026-05-23).
    userMessage = withTransaction(db, (tx) => {
      const inserted = chatRepository.insertChatMessage(tx, {
        id: userMessageInput.id,
        sessionId,
        role: 'user',
        body: userMessageInput.body,
        sourceKind: userRowAttribution.sourceKind,
        sourceLabel: userRowAttribution.sourceLabel,
        partialSessionId: userRowAttribution.partialSessionId,
        originChannel: userMessageInput.originChannel ?? null,
        thinkingBody: null,
        inputTokens: null,
        outputTokens: null,
        attachedImagesMetadata: userMessageInput.attachedImagesMetadata,
        errorCode: null,
        errorMessage: null,
        startedAt: now,
        completedAt: now,
        createdAt: now,
      })
      chatRepository.updateChatSession(tx, sessionId, { lastMessageAt: now })
      return inserted
    })
    events.push({ kind: 'user-message-persisted', message: userMessage })
  }

  return { sessionId, userMessage, events }
}
