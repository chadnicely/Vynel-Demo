// Integration tests for the `/models` routes: full HTTP stack over a real
// loopback model server and a real temp directory — the status read, the
// fire-and-poll download, remove, and the honest 409 where no engine manages
// models.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { ModelDownloadRunner, type LocalModelsDeps } from '@vynel/models'
import {
  fakeFileModel,
  startLocalModelServer,
  withTempModelsDir,
  type LocalModelServer,
} from '@vynel/models/test-support'
import type { Database } from '@vynel/db'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

let server: LocalModelServer
beforeAll(async () => {
  server = await startLocalModelServer({ '/fake-vad.onnx': Buffer.from('onnx-bytes') })
})
afterAll(() => server.close())

function seedUser(db: Database): void {
  const now = new Date()
  insertUser(db, {
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

function depsFor(baseDir: string): LocalModelsDeps {
  return {
    catalog: [fakeFileModel(server.baseUrl)],
    baseDirFor: () => baseDir,
    runner: new ModelDownloadRunner(),
  }
}

describe('models routes', () => {
  it('answers 409 on an engine that does not manage local models', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })
      expect((await app.request('/models')).status).toBe(409)
    })
  })

  it('lists the catalog with state, downloads one to installed, then removes it', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      await withTempModelsDir(async (baseDir) => {
        const localModels = depsFor(baseDir)
        const app = createApp({ db, logger: silentLogger, localModels })

        const listed = await app.request('/models')
        expect(listed.status).toBe(200)
        expect(await listed.json()).toEqual({
          models: [expect.objectContaining({ id: 'fake-vad', kind: 'vad', state: 'missing', download: null })],
        })

        const started = await app.request('/models/fake-vad/download', { method: 'POST' })
        expect(started.status).toBe(200)
        expect(await started.json()).toMatchObject({ id: 'fake-vad', state: 'downloading' })

        await localModels.runner.whenSettled('fake-vad')
        const after = (await (await app.request('/models')).json()) as {
          models: Array<{ state: string; installedAt: string | null; download: { bytes: number } }>
        }
        expect(after.models[0]).toMatchObject({ state: 'installed', download: { bytes: 10 } })
        expect(after.models[0]!.installedAt).not.toBeNull()

        const removed = await app.request('/models/fake-vad', { method: 'DELETE' })
        expect(removed.status).toBe(200)
        expect(await removed.json()).toMatchObject({ id: 'fake-vad', state: 'missing' })
      })
    })
  })

  it('404s an unknown model and 409s a second start while one runs', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      await withTempModelsDir(async (baseDir) => {
        const localModels = depsFor(baseDir)
        const app = createApp({ db, logger: silentLogger, localModels })
        expect((await app.request('/models/nope/download', { method: 'POST' })).status).toBe(404)
        expect((await app.request('/models/nope', { method: 'DELETE' })).status).toBe(404)

        expect((await app.request('/models/fake-vad/download', { method: 'POST' })).status).toBe(200)
        expect((await app.request('/models/fake-vad/download', { method: 'POST' })).status).toBe(409)
        expect((await app.request('/models/fake-vad', { method: 'DELETE' })).status).toBe(409)

        const cancelled = await app.request('/models/fake-vad/cancel', { method: 'POST' })
        expect(await cancelled.json()).toEqual({ cancelled: true })
        await localModels.runner.whenSettled('fake-vad')
        expect(await (await app.request('/models/fake-vad/cancel', { method: 'POST' })).json()).toEqual({
          cancelled: false,
        })
      })
    })
  })
})
