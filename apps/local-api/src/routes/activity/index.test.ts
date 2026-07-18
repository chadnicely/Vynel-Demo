// Route test for GET /activity/stream — the SSE liveness feed. Drives the
// REAL app (createApp + a real SQLite test db) with an injected feed: asserts
// the live publish path, the snapshot replay for a mid-turn attach, and that
// the stream frames carry the SessionActivityEvent JSON.

import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { getOrCreateLocalUser } from '@vynel/core/users'
import { SessionActivityFeed } from '@vynel/session/runtime'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

/** Read the stream until `predicate` matches the accumulated text (or timeout). */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 2_000,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + timeoutMs
  try {
    while (!predicate(text) && Date.now() < deadline) {
      const race = await Promise.race([
        reader.read(),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
      ])
      if (race === 'timeout') continue
      if (race.done) break
      text += decoder.decode(race.value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return text
}

describe('GET /activity/stream', () => {
  it('streams turn-started / turn-updated / turn-ended published after attach', async () => {
    await withTestDatabase(async (db) => {
      const activityFeed = new SessionActivityFeed()
      const app = createApp({ db, logger: silentLogger, activityFeed })
      const userId = getOrCreateLocalUser(db, { logger: silentLogger }).id

      const res = await app.request('/activity/stream')
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/event-stream')

      // Let the SSE callback attach its subscriber, then play a producer.
      await new Promise((resolve) => setTimeout(resolve, 25))
      const handle = activityFeed.begin({ userId, scopeKind: 'global', origin: 'telegram' })
      handle.sessionResolved('sess-42')
      handle.end()

      const text = await readUntil(res.body!, (t) => t.includes('turn-ended'))
      expect(text).toContain('event: turn-started')
      expect(text).toContain('"origin":"telegram"')
      expect(text).toContain('event: turn-updated')
      expect(text).toContain('"sessionId":"sess-42"')
      expect(text).toContain('event: turn-ended')
    })
  })

  it('replays the in-flight snapshot to a subscriber attaching mid-turn', async () => {
    await withTestDatabase(async (db) => {
      const activityFeed = new SessionActivityFeed()
      const app = createApp({ db, logger: silentLogger, activityFeed })
      const userId = getOrCreateLocalUser(db, { logger: silentLogger }).id

      const handle = activityFeed.begin({
        userId,
        scopeKind: 'workspace',
        workspaceId: 'ws-1',
        origin: 'schedule',
      })
      handle.sessionResolved('sess-7')

      const res = await app.request('/activity/stream')
      const text = await readUntil(res.body!, (t) => t.includes('turn-started'))
      handle.end()

      expect(text).toContain('event: turn-started')
      expect(text).toContain('"workspaceId":"ws-1"')
      expect(text).toContain('"sessionId":"sess-7"') // snapshot carries learned identity
      expect(text).toContain('"origin":"schedule"')
    })
  })

  it("does not leak another user's turns", async () => {
    await withTestDatabase(async (db) => {
      const activityFeed = new SessionActivityFeed()
      const app = createApp({ db, logger: silentLogger, activityFeed })
      getOrCreateLocalUser(db, { logger: silentLogger })

      activityFeed.begin({ userId: 'someone-else', scopeKind: 'global', origin: 'web' })

      const res = await app.request('/activity/stream')
      const text = await readUntil(res.body!, (t) => t.includes('turn-started'), 500)
      expect(text).not.toContain('turn-started')
    })
  })
})
