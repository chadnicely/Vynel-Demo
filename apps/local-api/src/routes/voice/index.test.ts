// The /voice/speak surface's remote-engine contract: a remote daemon has no
// speaker (its loopback voice URL would resolve to the SERVER), so `speak`
// answers unavailable WITHOUT probing — while a local daemon still relays.
// Full HTTP stack, the capabilities route test's setup style.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedUser(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

async function postSpeak(app: ReturnType<typeof createApp>): Promise<{ spoken: boolean; reason?: string }> {
  const response = await app.request('/voice/speak', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello' }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { spoken: boolean; reason?: string }
}

describe('POST /voice/speak', () => {
  it('answers unavailable on a remote engine without touching the daemon', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger, remoteEngine: true })
      const body = await postSpeak(app)
      expect(body.spoken).toBe(false)
      expect(body.reason).toContain('remote server')
    })
  })

  it('takes the relay path on a local engine, whatever the daemon answers', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })
      const body = await postSpeak(app)
      // Deliberately NOT asserting spoken/true-or-false: a dev machine may
      // have a real voice daemon on the loopback port (it did — this test
      // failed that way once). The invariant is that the REMOTE short-circuit
      // stayed out of the way, so the relay is what answered.
      expect(body.reason ?? '').not.toContain('remote server')
    })
  })
})
