// The /voice surface's remote-engine contracts: a remote engine has no speaker
// and no call cables (its loopback URLs would resolve to the SERVER), so speak
// and every call tool answer honestly WITHOUT probing — while a local engine
// still relays. Full HTTP stack, the capabilities route test's setup style.
// The daemon-relay mechanics themselves are covered in
// calls-through-daemon.test.ts with a stubbed fetch.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { listAllChatSessionsForUser } from '@vynel/chat/repositories'
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

describe('the call tools on a remote engine', () => {
  it('start_call refuses without spawning a session or touching the daemon', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger, remoteEngine: true })
      const response = await app.request('/voice/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: '9pm standup', mode: 'notetaker' }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { started: boolean; reason?: string }
      expect(body.started).toBe(false)
      expect(body.reason).toContain('remote server')
    })
  })

  it('start_call with capturePid AND captureProcessName refuses BEFORE creating the session', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      // Local engine: past the remote guard — the both-given check must be the
      // one that stops it, and it must stop it before the session side effect
      // (the daemon rejects the pair too, but by then a call session per
      // attempt would already be orphaned in the Sessions panel).
      const app = createApp({ db, logger: silentLogger, remoteEngine: false })
      const response = await app.request('/voice/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'meet', capturePid: 10, captureProcessName: 'chrome' }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { started: boolean; reason?: string }
      expect(body.started).toBe(false)
      expect(body.reason).toContain('not both')
      expect(listAllChatSessionsForUser(db, { userId: user.id })).toEqual([])
    })
  })

  it('list_calls answers empty and end_call answers honestly', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger, remoteEngine: true })

      const listed = await app.request('/voice/calls')
      expect(await listed.json()).toEqual({ calls: [] })

      const ended = await app.request('/voice/calls/call-1', { method: 'DELETE' })
      const endedBody = (await ended.json()) as { ended: boolean; reason?: string }
      expect(endedBody.ended).toBe(false)
      expect(endedBody.reason).toContain('remote server')
    })
  })

  it('speak with a callId refuses the same way', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger, remoteEngine: true })
      const response = await app.request('/voice/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello', callId: 'call-1' }),
      })
      const body = (await response.json()) as { spoken: boolean; reason?: string }
      expect(body.spoken).toBe(false)
      expect(body.reason).toContain('remote server')
    })
  })
})

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
