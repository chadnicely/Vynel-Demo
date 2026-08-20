// The CHAT leg of a verbatim reminder (schedule-gaps G2): the deps'
// `recordScheduleChatNotice` must resolve the DESTINATION conversation — the
// workspace's continuing one, or the user's global one for a global schedule —
// and land the reminder on its head as a quiet notice signed "Schedule · X",
// with the body word for word. A scope that has never held a conversation
// answers 'no-thread' rather than inventing one. The DB and the continuity
// resolution are REAL (withTestDatabase — never mock the DB).

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { HonoAppRequestFn } from '../factory.js'

// Keep the SDK-heavy descriptor modules out (the schedules-service.test stub).
vi.mock('@vynel/mcp', () => ({
  vynelWorkspaceDescriptor: { serverName: 'vynel', build: () => null },
}))
vi.mock('@vynel/instructions', () => ({
  notebookFeatureDescriptor: { serverName: 'vynel-notebook', build: () => null },
}))

import { SessionActivityFeed } from '@vynel/session/runtime'
import { SessionTargetLocks } from '@vynel/session/delegation'
import { getOrCreatePrimarySession, linkPrimarySessionToSdkSession } from '@vynel/session/continuity'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, listChatMessagesForSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { buildScheduleFireDeps } from './build-schedule-fire-deps.js'

const silentLogger = pino({ level: 'silent' })
const fakeAppRequest = vi.fn() as unknown as HonoAppRequestFn

function seedUser(db: Database): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

function seedWorkspace(db: Database, userId: string): string {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Letterman',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }).id
}

/** A scope whose continuing conversation already runs on a head segment. */
async function seedContinuingConversation(
  db: Database,
  userId: string,
  workspaceId: string | null,
): Promise<string> {
  const headSdkSessionId = `sdk-${randomUUID()}`
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: headSdkSessionId,
      userId,
      workspaceId,
      providerId: 'claude',
      startedAt: new Date(),
    }),
  )
  const primary = await getOrCreatePrimarySession(db, { userId, workspaceId })
  linkPrimarySessionToSdkSession(db, {
    primarySessionId: primary.id,
    userId,
    sdkSessionId: headSdkSessionId,
  })
  return headSdkSessionId
}

async function buildDeps() {
  return buildScheduleFireDeps({
    appRequest: fakeAppRequest,
    logger: silentLogger,
    activityFeed: new SessionActivityFeed(),
    targetLocks: new SessionTargetLocks(),
  })
}

describe('buildScheduleFireDeps — the verbatim reminder chat notice (schedule-gaps G2)', () => {
  it('lands the reminder on the WORKSPACE conversation head, signed and verbatim', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)
      const head = await seedContinuingConversation(db, userId, workspaceId)

      const outcome = (await buildDeps()).recordScheduleChatNotice(db, {
        userId,
        workspaceId,
        sourceLabel: 'Schedule · Meeting',
        body: 'Attend your 2pm meeting.',
      })

      expect(outcome).toBe('written')
      const [row] = listChatMessagesForSession(db, head)
      expect(row!.sourceKind).toBe('system')
      expect(row!.sourceLabel).toBe('Schedule · Meeting')
      expect(row!.body).toBe('Attend your 2pm meeting.')
    })
  })

  it('lands a GLOBAL schedule on the user’s global conversation head', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const head = await seedContinuingConversation(db, userId, null)

      const outcome = (await buildDeps()).recordScheduleChatNotice(db, {
        userId,
        workspaceId: null,
        sourceLabel: 'Schedule · Tea',
        body: 'Time for tea.',
      })

      expect(outcome).toBe('written')
      expect(listChatMessagesForSession(db, head)[0]!.body).toBe('Time for tea.')
    })
  })

  it('lands the SAME reminder text every time — a daily reminder must never dedupe', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)
      const head = await seedContinuingConversation(db, userId, workspaceId)
      const deps = await buildDeps()
      const notice = {
        userId,
        workspaceId,
        sourceLabel: 'Schedule · Meeting',
        body: 'Attend your 2pm meeting.',
      }

      expect(deps.recordScheduleChatNotice(db, notice)).toBe('written')
      expect(deps.recordScheduleChatNotice(db, notice)).toBe('written')

      // Two rows, not one: the note home's latest-row dedupe is deliberately
      // never asked for here, which is what keeps 'already-latest' unreachable.
      expect(listChatMessagesForSession(db, head)).toHaveLength(2)
    })
  })

  it('answers no-thread for a scope that has never held a conversation', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)

      expect(
        (await buildDeps()).recordScheduleChatNotice(db, {
          userId,
          workspaceId,
          sourceLabel: 'Schedule · Meeting',
          body: 'Attend your 2pm meeting.',
        }),
      ).toBe('no-thread')
    })
  })
})
