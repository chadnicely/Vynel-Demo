// The SYSTEM-NOTIFICATION variant of the notify machinery (task-execution
// arc) — real SQLite + fake provider, end-to-end through the tick: a delivery
// whose reporter is a synthetic system producer (`task:<id>` — the pickup
// nudge) runs under the SYSTEM marker + steer and its inbound row is stamped
// `sourceKind: 'system'`, so the UI renders a quiet notice instead of a
// participant message (Kafi's 2026-08-18 smoke).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { StartChatSessionInput } from '@vynel/providers'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, listChatMessagesForSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { consumeTaskCreatedEvent, findDelegationJobById } from '@vynel/orchestration'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

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
    managerName: 'Mark',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

async function seedLinkedWorkspacePrimary(
  db: Database,
  userId: string,
  workspaceId: string,
  sdkSessionId: string,
) {
  const primary = await getOrCreatePrimarySession(db, { userId, workspaceId })
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: sdkSessionId,
      userId,
      workspaceId,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Workspace root',
      visibility: 'hidden',
    }),
  )
  linkPrimarySessionToSdkSession(db, { primarySessionId: primary.id, userId, sdkSessionId })
  return primary
}

describe('system-notification deliveries (the task pickup nudge)', () => {
  it('the nudge runs under the SYSTEM marker + steer and stamps the inbound row sourceKind system', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await seedLinkedWorkspacePrimary(db, user.id, workspace.id, 'ws-primary-s1')

      const jobId = consumeTaskCreatedEvent(db, {
        taskId: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        title: 'Research SEO for the shop',
        source: 'user',
        createdAt: new Date().toISOString(),
      })

      const notifyInputs: StartChatSessionInput[] = []
      const delivered = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-primary-s1',
          resultText: 'Picking it up.',
          startChatSessionInputs: notifyInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(delivered).toBe(true)
      expect(findDelegationJobById(db, jobId!)?.status).toBe('completed')

      // The SYSTEM steer, never the report steer.
      expect(notifyInputs[0]!.systemPromptAppend).toContain('SYSTEM NOTIFICATION')
      expect(notifyInputs[0]!.systemPromptAppend).not.toContain('This message is a REPORT')

      // The inbound row wears the system marker AND the system source kind —
      // the UI's quiet-notice rendering keys off exactly this stamp.
      const messages = listChatMessagesForSession(db, 'ws-primary-s1')
      expect(messages[0]!.role).toBe('user')
      expect(messages[0]!.body.startsWith('[System notification from Tasks')).toBe(true)
      expect(messages[0]!.body).toContain('Research SEO for the shop')
      expect(messages[0]!.sourceKind).toBe('system')
      expect(messages[0]!.sourceLabel).toBe('Tasks')
    })
  })
})
