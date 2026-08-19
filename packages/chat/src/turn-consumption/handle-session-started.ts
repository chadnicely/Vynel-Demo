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
import { SWAP_SEGMENT_TITLE } from '../records/record-swap-segment-session.js'
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
  /** Set when the consumer already persisted the user row BEFORE provider
   *  startup (the resumed-session durability write) — both branches then skip
   *  the insert and the `user-message-persisted` event (already emitted). */
  alreadyPersistedUserMessage?: ChatMessage
  userId: string
  /** Null for a global-root (brain) session — `buildNewChatSessionRow` derives
   *  `scope: 'global'` from it, and the co-committed outbox payload carries null. */
  workspaceId: string | null
  providerId: AiAgentProviderId
  isNewSession: boolean
  /** The session this turn RESUMED (when known). A `session-started` reporting
   *  a DIFFERENT id on a resumed turn is a mid-turn compaction swap — the
   *  created row chain-links to this predecessor and wears the swap-segment
   *  presentation (session-review B4). */
  resumeSessionId?: string
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
    alreadyPersistedUserMessage,
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
    threadId: messageAttribution?.threadId ?? null,
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
    // The row-missing case on a RESUMED turn is a mid-turn compaction swap: the
    // created row must CHAIN to its predecessor (`continuedFromSessionId`) and
    // wear the swap-segment presentation, or the segment is orphaned — the
    // overview can't fold it, chain-follow can't engage, and the global
    // transcript loses every pre-swap row on reload (session-review B4).
    // Explicit newSessionOptions still win; the predecessor supplies the scope
    // a caller didn't pass (a spawned session's continuation must never default
    // to 'global', nor a workspace primary's land listed as "New session").
    const swappedFromSessionId =
      !isNewSession && input.resumeSessionId !== undefined && input.resumeSessionId !== sessionId
        ? input.resumeSessionId
        : null
    const predecessor =
      swappedFromSessionId !== null
        ? chatRepository.findChatSessionById(db, swappedFromSessionId)
        : null
    userMessage = withTransaction(db, (tx) => {
      // initialMessageCount: 1 — the user message is co-committed below. When
      // the consumer persisted it early (resumed turn whose SDK id swapped
      // mid-start), the message already lives on the ORIGINAL session — the
      // thread the user actually sent it from — so this row starts at 0.
      chatRepository.insertChatSession(tx, {
        ...buildNewChatSessionRow({
          sessionId,
          userId,
          workspaceId,
          providerId,
          startedAt: now,
          initialMessageCount: alreadyPersistedUserMessage !== undefined ? 0 : 1,
          ...(newSessionOptions?.visibility !== undefined
            ? { visibility: newSessionOptions.visibility }
            : swappedFromSessionId !== null
              ? { visibility: 'hidden' as const }
              : {}),
          ...(newSessionOptions?.title !== undefined
            ? { title: newSessionOptions.title }
            : swappedFromSessionId !== null
              ? { title: SWAP_SEGMENT_TITLE }
              : {}),
          ...(newSessionOptions?.scope !== undefined
            ? { scope: newSessionOptions.scope }
            : predecessor !== null
              ? { scope: predecessor.scope }
              : {}),
        }),
        // The chain link stays OFF the shared builder (the swap-segment
        // recorder's rule) — only a continuation row carries a predecessor.
        ...(swappedFromSessionId !== null
          ? { continuedFromSessionId: swappedFromSessionId }
          : {}),
        // Composer settings + the assistant-set status follow the chain: a
        // swap must not silently reset the user's chosen mode/model/effort —
        // or drop a standing "problem/needs_input" light — back to "never
        // set"; the fresh segment inherits its predecessor's values (settings
        // stay overridable by the streams' write-through, the status by the
        // read-time supersession rule).
        ...(predecessor !== null
          ? {
              sessionMode: predecessor.sessionMode,
              selectedModel: predecessor.selectedModel,
              thinkingEffort: predecessor.thinkingEffort,
              autoBuildout: predecessor.autoBuildout,
              status: predecessor.status,
              statusNote: predecessor.statusNote,
              statusSetAt: predecessor.statusSetAt,
            }
          : {}),
      })
      const inserted =
        alreadyPersistedUserMessage ??
        chatRepository.insertChatMessageIfAbsent(tx, {
          id: userMessageInput.id,
          sessionId,
          role: 'user',
          body: userMessageInput.body,
          sourceKind: userRowAttribution.sourceKind,
          sourceLabel: userRowAttribution.sourceLabel,
          partialSessionId: userRowAttribution.partialSessionId,
          threadId: userRowAttribution.threadId,
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
        }).message
      insertOutboxEvent(tx, {
        id: crypto.randomUUID(),
        type: CHAT_SESSION_CREATED,
        payload: { userId, workspaceId, sessionId, providerId },
        createdAt: new Date(),
        processedAt: null,
      })
      return inserted
    })

    if (alreadyPersistedUserMessage === undefined) {
      events.push({ kind: 'user-message-persisted', message: userMessage })
    }
    const newSession = chatRepository.findChatSessionById(db, sessionId)
    if (newSession) events.push({ kind: 'session-created', session: newSession })
  } else if (alreadyPersistedUserMessage !== undefined) {
    // Resumed session whose user row was persisted before provider startup —
    // nothing to insert, the event already went out.
    userMessage = alreadyPersistedUserMessage
  } else {
    // Resumed session: session row already exists. Wrap the user-message
    // insert + lastMessageAt bump in one transaction so a failure doesn't
    // leave a message attached to a session with a stale lastMessageAt
    // (chat Gate 3 S4 2026-05-23).
    userMessage = withTransaction(db, (tx) => {
      const { message: inserted, inserted: isNew } = chatRepository.insertChatMessageIfAbsent(tx, {
        id: userMessageInput.id,
        sessionId,
        role: 'user',
        body: userMessageInput.body,
        sourceKind: userRowAttribution.sourceKind,
        sourceLabel: userRowAttribution.sourceLabel,
        partialSessionId: userRowAttribution.partialSessionId,
        threadId: userRowAttribution.threadId,
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
      if (isNew) chatRepository.updateChatSession(tx, sessionId, { lastMessageAt: now })
      return inserted
    })
    events.push({ kind: 'user-message-persisted', message: userMessage })
  }

  return { sessionId, userMessage, events }
}
