// Integration tests for the `/server-install` routes: full HTTP stack over a
// REAL loopback ssh2 server — the credential's one-way door, the fire-and-
// track provision kick, the step-progress poll, and the stripping boundary
// (no sealed blob ever in a response).

import { describe, it, expect } from 'vitest'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { withTestDatabase, startFakeSshServer } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })
const masterKey = randomBytes(32).toString('base64')

const DEBIAN_PREFLIGHT = [
  'arch=x86_64',
  'libc=ldd (Debian GLIBC 2.41-12) 2.41',
  'systemd=yes',
  'tar=yes',
  'home=/home/dana',
  '',
].join('\n')

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

function makeArchive(): { dir: string; archive: { path: string; sha256: string; cpu: 'x64' } } {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-install-route-test-'))
  const bytes = randomBytes(1024)
  const path = join(dir, 'engine.tar.gz')
  writeFileSync(path, bytes)
  return {
    dir,
    archive: { path, sha256: createHash('sha256').update(bytes).digest('hex'), cpu: 'x64' },
  }
}

describe('server-install routes', () => {
  it('refuses to start without an engine payload on this machine', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger, sshMasterKeyBase64: masterKey })
      const response = await app.request('/server-install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          host: '127.0.0.1',
          username: 'dana',
          credentials: { authKind: 'password', password: 'x' },
        }),
      })
      expect(response.status).toBe(409)
    })
  })

  it('provisions through the full HTTP surface: start, poll to installed, no sealed blobs', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const { dir, archive } = makeArchive()
      const server = await startFakeSshServer({
        enableSftp: true,
        execHandler: (command) => {
          if (command.includes('uname -m')) return { stdout: DEBIAN_PREFLIGHT }
          if (command === 'id -u') return { stdout: '1000\n' }
          if (command.startsWith('sha256sum'))
            return { stdout: `${archive.sha256}  /home/dana/.vynel/payload.tar.gz\n` }
          if (command.includes('/health')) return { stdout: '{"status":"ok","version":"7.7.7"}\n' }
          return {}
        },
      })
      try {
        const app = createApp({
          db,
          logger: silentLogger,
          sshMasterKeyBase64: masterKey,
          serverPayloadArchive: archive,
          appVersion: '7.7.7',
        })
        const started = await app.request('/server-install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            host: '127.0.0.1',
            port: server.port,
            username: 'dana',
            credentials: { authKind: 'password', password: 'sourdough' },
          }),
        })
        expect(started.status).toBe(200)
        const startedBody = (await started.json()) as Record<string, unknown>
        expect(startedBody['status']).toBe('provisioning')
        expect(startedBody['encryptedCredentials']).toBeUndefined()
        expect(startedBody['sealedAuthToken']).toBeUndefined()

        // Fire-and-track: poll the progress surface until it settles.
        const installId = startedBody['id'] as string
        let finalBody: Record<string, unknown> = startedBody
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline && finalBody['status'] === 'provisioning') {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
          const polled = await app.request(`/server-install/${installId}`)
          expect(polled.status).toBe(200)
          finalBody = (await polled.json()) as Record<string, unknown>
        }
        expect(finalBody['status']).toBe('installed')
        expect(finalBody['installedVersion']).toBe('7.7.7')
        expect(finalBody['errorMessage']).toBeNull()
        expect(finalBody['sealedAuthToken']).toBeUndefined()

        const listed = await app.request('/server-install')
        expect(((await listed.json()) as unknown[]).length).toBe(1)

        const removed = await app.request(`/server-install/${installId}`, { method: 'DELETE' })
        expect(removed.status).toBe(204)
        const afterRemove = await app.request(`/server-install/${installId}`)
        expect(afterRemove.status).toBe(404)
      } finally {
        await server.close()
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  it('404s an unknown install id', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger, sshMasterKeyBase64: masterKey })
      const response = await app.request('/server-install/nope')
      expect(response.status).toBe(404)
    })
  })
})
