// Core op — populate chat_sessions from the SDK's persisted transcripts.
// Per D10: imported sessions are stubs (no messages eagerly imported);
// transcripts are fetched on demand by `provider.fetchPersistedSessionTranscript`
// when the user opens an imported session.
//
// Called on workspace open (via the useChat composable's refreshSessions)
// and via a manual "Refresh sessions" affordance in the UI. Phase 1 omits
// `since` (re-syncs everything); Phase 1.5 may track `lastSyncedAt` per
// workspace for incremental sync.
//
// Spec: `docs/blueprints/chat/blueprint.md §13`.
//
// Split into the provider-calling shell + the pure-data `importPersistedSessions`
// helper at ship time per Gate 3 finding S2 — provider mockability is hard
// at the registry layer; the workspace-filter + insert loop IS pure logic
// + has its own test (synchronize-chat-sessions-for-workspace.test.ts).

import { resolveAiAgentProvider } from '@vynel/providers'
import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { AiAgentProviderId, PersistedSessionRecord } from '@vynel/providers'

export type SynchronizeChatSessionsInput = {
  workspaceId: string
  workspacePath: string
  userId: string
  providerId: AiAgentProviderId
  /** Optional cutoff — omitted in Phase 1 (re-syncs everything). */
  since?: Date
}

export async function synchronizeChatSessionsForWorkspace(
  db: Database,
  input: SynchronizeChatSessionsInput,
): Promise<{ importedCount: number }> {
  const provider = resolveAiAgentProvider(input.providerId)
  const persisted = await provider.synchronizePersistedSessions(input.since)
  return importPersistedSessions(db, persisted, input)
}

/**
 * Pure-data import loop: walks the SDK-supplied PersistedSessionRecord[],
 * filters to records that match this workspace's path, skips any whose
 * sessionId already exists in chat_sessions, inserts the rest as stubs.
 *
 * Exported so the synchronize op's domain logic is unit-testable without
 * needing to mock the provider registry. See `*.test.ts` sibling.
 */
export function importPersistedSessions(
  db: Database,
  persisted: PersistedSessionRecord[],
  input: Pick<
    SynchronizeChatSessionsInput,
    'workspaceId' | 'workspacePath' | 'userId' | 'providerId'
  >,
): { importedCount: number } {
  let importedCount = 0
  const now = new Date()

  for (const p of persisted) {
    if (p.workspacePath !== input.workspacePath) continue

    const existing = chatRepository.findChatSessionById(db, p.sessionId)
    if (existing) continue

    chatRepository.insertChatSession(db, {
      id: p.sessionId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      // Use the first-user-message preview as the title; users can rename
      // anytime via PATCH /sessions/:id. Falls back when the SDK has no
      // first message (truly empty session).
      title: p.firstUserMessagePreview ?? 'Imported session',
      isArchived: false,
      deletedAt: null,
      // PersistedSessionRecord.turnCount is the per-turn count; chat's
      // totalMessageCount is rough-equivalent for the imported stub. The
      // counter will become accurate once the user resumes + streams new
      // messages.
      totalMessageCount: p.turnCount,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      startedAt: p.startedAt,
      lastMessageAt: p.lastModifiedAt,
      updatedAt: now,
    })
    importedCount += 1
  }

  return { importedCount }
}
