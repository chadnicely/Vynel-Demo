// Test for `recordPushedReportMessage` — real SQLite. Verifies the report lands on an
// existing global-root session attributed `workspace-manager` + label, and that a missing
// session is a no-op returning false (a pushed report never mints a global-root session).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { findChatSessionById, listChatMessagesForSession, insertChatSession } from '../repositories/index.js'
import { buildNewChatSessionRow } from '../turn-consumption/build-new-chat-session-row.js'
import { recordPushedReportMessage } from './record-pushed-report-message.js'

// Seed a brain (global-root) chat_sessions row directly — the test precondition.
// The session unification removed recordGlobalRootSession (the brain now creates its
// row through consumeSessionEventStream); a direct insert is the lightweight setup.
function seedBrainSession(db: Database, sessionId: string, userId: string): void {
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Global brain',
      visibility: 'hidden',
    }),
  )
}

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

describe('recordPushedReportMessage', () => {
  it('pushes an attributed workspace-manager report onto an existing global-root session', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      seedBrainSession(db, 'global-sdk-1', user.id)

      const pushed = recordPushedReportMessage(db, {
        globalRootSessionId: 'global-sdk-1',
        body: 'Acme is healthy; 3 docs current.',
        workspaceName: 'Acme',
      })

      expect(pushed).toBe(true)
      const [report] = listChatMessagesForSession(db, 'global-sdk-1')
      expect([report!.role, report!.sourceKind, report!.sourceLabel, report!.body]).toEqual([
        'assistant',
        'workspace-manager',
        'Acme',
        'Acme is healthy; 3 docs current.',
      ])
      // Additive: an un-correlated push leaves the trace key null.
      expect(report!.partialSessionId).toBeNull()
    })
  })

  it('stamps the partialSessionId onto the pushed report when given (the trace key)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      seedBrainSession(db, 'global-sdk-2', user.id)

      recordPushedReportMessage(db, {
        globalRootSessionId: 'global-sdk-2',
        body: 'All clear.',
        workspaceName: 'Acme',
        partialSessionId: 'trace-1',
      })

      const [report] = listChatMessagesForSession(db, 'global-sdk-2')
      expect(report!.partialSessionId).toBe('trace-1')
    })
  })

  it('returns false and inserts nothing when the global-root session is missing', async () => {
    await withTestDatabase((db) => {
      const pushed = recordPushedReportMessage(db, {
        globalRootSessionId: 'does-not-exist',
        body: 'orphan report',
        workspaceName: 'Acme',
      })

      expect(pushed).toBe(false)
      expect(findChatSessionById(db, 'does-not-exist')).toBeNull()
    })
  })
})
