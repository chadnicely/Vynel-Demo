// `recordSpawnedSessionSegment` — records the `chat_sessions` row for the FIRST
// segment of a SPAWNED session (session-library Slice ④). The root creates
// sessions as a tool (`create_session`): the priming turn mints the SDK session,
// and this records it as a LISTED, NAMED conversation — unlike its sibling
// `recordSwapSegmentSession`, which hard-codes the hidden swap-segment
// presentation ("the continuing brain shows as ONE entry"). A spawned session
// is a first-class entry in the Sessions panel from birth, so its first
// segment is `visibility: 'listed'`, `scope: 'spawned'`, `title` = the
// session's name (the identity rule: the FIRST segment's title IS the name —
// later swap segments keep the stock hidden title and the chain fold surfaces
// this one).
//
// Grounding: spawned sessions inherit the creator's scope (Slice ④b) — a
// GLOBAL-root creation passes no `workspaceId` (the session runs in the root's
// hidden user-data cwd, same ground as the brain); a WORKSPACE creation passes
// its workspace id, so the segment lists under that workspace (the overview
// then shows the workspace name for free).
//
// Like the swap sibling: the segment starts EMPTY (0 messages) — the priming
// exchange lives only in the runtime's session storage; the first delegated
// task populates it via the normal resumed-turn flow. Co-commits the
// `chat.session-created` outbox event in the same transaction ("everything is
// recorded; the list is curated").
//
// THE BIRTH STAMP (session-hardening D4): the creator's resolved settings are
// written HERE, at insert, rather than PATCHed a moment later — a child born
// with NULL settings ran the bare default for its whole first turn, so a
// parent on bypass could spawn a child that cards. This is the only write
// where the settings are not the user's own choice, which is why it belongs to
// the birth op and not to `updateChatSessionSettings`.

import { withTransaction, type Database } from '@vynel/db'
import * as chatRepository from '../repositories/index.js'
import type { ChatSession } from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { AiAgentProviderId } from '@vynel/providers'
import { CHAT_SESSION_CREATED, type ChatSessionCreatedPayload } from '../chat-events.js'
import { buildNewChatSessionRow } from '../turn-consumption/build-new-chat-session-row.js'
import type { ChatSessionSettingsPatch } from '../settings/update-chat-session-settings.js'

export type RecordSpawnedSessionSegmentInput = {
  /** The SDK session id the priming turn minted — the recorded segment's PK. */
  sessionId: string
  userId: string
  providerId: AiAgentProviderId
  /** The spawned session's name — the first segment's title IS the identity. */
  name: string
  /** The creator's workspace (Slice ④b) — absent/null = global-grounded (v1). */
  workspaceId?: string | null
  /** When the segment was started. Defaults to now. */
  startedAt?: Date
  /** The CREATOR's resolved settings (D4) — the child is born running what its
   *  parent runs. Omit (a CLI or a voice call leg, which has no creating turn)
   *  and every field stays null: "never set", resolved to the default at turn
   *  time. A tool argument on a later turn still overrides the row. */
  settings?: ChatSessionSettingsPatch
}

export function recordSpawnedSessionSegment(
  db: Database,
  input: RecordSpawnedSessionSegmentInput,
): ChatSession {
  const startedAt = input.startedAt ?? new Date()
  const workspaceId = input.workspaceId ?? null
  const payload: ChatSessionCreatedPayload = {
    userId: input.userId,
    workspaceId,
    sessionId: input.sessionId,
    providerId: input.providerId,
  }

  const settings = input.settings ?? {}
  return withTransaction(db, (tx) => {
    const segment = chatRepository.insertChatSession(tx, {
      ...buildNewChatSessionRow({
        sessionId: input.sessionId,
        userId: input.userId,
        workspaceId,
        providerId: input.providerId,
        startedAt,
        title: input.name,
        initialMessageCount: 0,
        visibility: 'listed',
        scope: 'spawned',
      }),
      ...(settings.sessionMode !== undefined ? { sessionMode: settings.sessionMode } : {}),
      ...(settings.selectedModel !== undefined ? { selectedModel: settings.selectedModel } : {}),
      ...(settings.thinkingEffort !== undefined ? { thinkingEffort: settings.thinkingEffort } : {}),
      ...(settings.autoBuildout !== undefined ? { autoBuildout: settings.autoBuildout } : {}),
    })
    insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: CHAT_SESSION_CREATED,
      payload,
      createdAt: new Date(),
      processedAt: null,
    })
    return segment
  })
}
