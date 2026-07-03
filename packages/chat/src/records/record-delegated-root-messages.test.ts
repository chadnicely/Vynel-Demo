// Test for `recordDelegatedRootMessages` (brain-tree Phase 1) — the workspace-root
// delegation turn's task + result persist attributed by source identity. Real SQLite.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession } from '../repositories/index.js'
import { listChatMessagesForSession } from '../repositories/index.js'
import { buildNewChatSessionRow } from '../turn-consumption/build-new-chat-session-row.js'
import { recordDelegatedRootMessages } from './record-delegated-root-messages.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('recordDelegatedRootMessages', () => {
  it('persists the task as global-root and the result as workspace-manager (labeled)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // The workspace root segment (FK target) — recorded by the composition first.
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'ws-root-1',
          userId: user.id,
          workspaceId: workspace.id,
          providerId: 'claude',
          startedAt: new Date(),
          visibility: 'hidden',
        }),
      )

      recordDelegatedRootMessages(db, {
        sessionId: 'ws-root-1',
        taskText: 'summarize this week’s notes',
        resultText: 'Three notes; all shipped.',
        workspaceName: 'Acme',
      })

      const messages = listChatMessagesForSession(db, 'ws-root-1')
      expect(messages).toHaveLength(2)

      const [task, reply] = messages
      expect(task!.role).toBe('user')
      expect(task!.body).toBe('summarize this week’s notes')
      expect(task!.sourceKind).toBe('global-root')
      expect(task!.sourceLabel).toBeNull()

      expect(reply!.role).toBe('assistant')
      expect(reply!.body).toBe('Three notes; all shipped.')
      expect(reply!.sourceKind).toBe('workspace-manager')
      expect(reply!.sourceLabel).toBe('Acme')

      // Additive: an un-correlated delegation leaves both rows' trace key null.
      expect(task!.partialSessionId).toBeNull()
      expect(reply!.partialSessionId).toBeNull()
    })
  })

  it('stamps the partialSessionId onto both rows when given (the trace key)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'ws-root-3',
          userId: user.id,
          workspaceId: workspace.id,
          providerId: 'claude',
          startedAt: new Date(),
          visibility: 'hidden',
        }),
      )

      recordDelegatedRootMessages(db, {
        sessionId: 'ws-root-3',
        taskText: 'summarize the notes',
        resultText: 'Done.',
        workspaceName: 'Acme',
        partialSessionId: 'trace-1',
      })

      const [task, reply] = listChatMessagesForSession(db, 'ws-root-3')
      expect(task!.partialSessionId).toBe('trace-1')
      expect(reply!.partialSessionId).toBe('trace-1')
    })
  })

  it('skips the reply row when the result is empty (a read with no text)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'ws-root-2',
          userId: user.id,
          workspaceId: workspace.id,
          providerId: 'claude',
          startedAt: new Date(),
          visibility: 'hidden',
        }),
      )

      recordDelegatedRootMessages(db, {
        sessionId: 'ws-root-2',
        taskText: 'check the logs',
        resultText: '',
        workspaceName: 'Acme',
      })

      const messages = listChatMessagesForSession(db, 'ws-root-2')
      expect(messages).toHaveLength(1)
      expect(messages[0]!.sourceKind).toBe('global-root')
    })
  })
})
