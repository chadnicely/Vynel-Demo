// End-to-end provisioning against a REAL ssh2 loopback server (no mocks): the
// full step machine — connect + TOFU pin, preflight, upload + SHA verify,
// install file writes, service start, health — proven over an actual SSH
// handshake, with the row's step/status transitions asserted from SQLite.

import { describe, it, expect } from 'vitest'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { startFakeSshServer, type FakeSshExecReply } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { openSecret } from '@vynel/sealing'
import type { Database } from '@vynel/db'
import { startServerInstall } from './start-server-install.js'
import { runProvision, type ProvisionDeps } from './provision-server.js'
import { findServerInstallById, updateServerInstall } from '../repositories/index.js'

const masterKey = randomBytes(32).toString('base64')

const DEBIAN_PREFLIGHT = [
  'arch=x86_64',
  'libc=ldd (Debian GLIBC 2.41-12) 2.41',
  'systemd=yes',
  'tar=yes',
  'home=/home/dana',
  '',
].join('\n')

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

function makeArchive(): { dir: string; path: string; sha256: string; bytes: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-provision-test-'))
  const bytes = randomBytes(4096)
  const path = join(dir, 'engine.tar.gz')
  writeFileSync(path, bytes)
  return { dir, path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes }
}

function debianExecHandler(archiveSha: string): (command: string) => FakeSshExecReply {
  return (command) => {
    if (command.includes('uname -m')) return { stdout: DEBIAN_PREFLIGHT }
    if (command === 'id -u') return { stdout: '1000\n' }
    if (command.startsWith('sha256sum'))
      return { stdout: `${archiveSha}  /home/dana/.vynel/payload.tar.gz\n` }
    if (command.includes('/health')) return { stdout: '{"status":"ok","version":"9.9.9-test"}\n' }
    return {}
  }
}

async function provisionAgainstFake(
  db: Database,
  options: {
    execHandler: (command: string) => FakeSshExecReply
    archive: ReturnType<typeof makeArchive>
    payloadCpu?: 'x64' | 'arm64'
    pinnedFingerprint?: string
  },
): Promise<{
  installId: string
  executedCommands: string[]
  writtenFiles: Map<string, Buffer>
  runError: unknown
}> {
  const userId = seedUser(db)
  const server = await startFakeSshServer({ execHandler: options.execHandler, enableSftp: true })
  try {
    const install = startServerInstall(
      db,
      {
        userId,
        host: '127.0.0.1',
        port: server.port,
        username: 'dana',
        credentials: { authKind: 'password', password: 'sourdough' },
      },
      { masterKeyBase64: masterKey },
    )
    if (options.pinnedFingerprint !== undefined) {
      updateServerInstall(db, install.id, { hostKeyFingerprint: options.pinnedFingerprint })
    }
    const deps: ProvisionDeps = {
      masterKeyBase64: masterKey,
      appVersion: '9.9.9-test',
      payloadArchive: {
        path: options.archive.path,
        sha256: options.archive.sha256,
        cpu: options.payloadCpu ?? 'x64',
      },
      healthDeadlineMs: 5_000,
      healthIntervalMs: 25,
    }
    let runError: unknown = null
    try {
      await runProvision(db, install.id, deps)
    } catch (error) {
      runError = error
    }
    return {
      installId: install.id,
      executedCommands: server.executedCommands,
      writtenFiles: server.writtenFiles,
      runError,
    }
  } finally {
    await server.close()
    rmSync(options.archive.dir, { recursive: true, force: true })
  }
}

describe('runProvision', () => {
  it('provisions end-to-end: pin, preflight, upload, install files, start, health', async () => {
    await withTestDatabase(async (db) => {
      const archive = makeArchive()
      const outcome = await provisionAgainstFake(db, {
        execHandler: debianExecHandler(archive.sha256),
        archive,
      })
      expect(outcome.runError).toBeNull()

      const row = findServerInstallById(db, outcome.installId)
      expect(row?.status).toBe('installed')
      expect(row?.installedVersion).toBe('9.9.9-test')
      expect(row?.hostKeyFingerprint).toMatch(/^[A-Za-z0-9+/=]+$/)
      expect(row?.lastHealthyAt).not.toBeNull()
      expect(row?.errorMessage).toBeNull()

      // The payload traveled intact.
      expect(outcome.writtenFiles.get('/home/dana/.vynel/payload.tar.gz')).toEqual(archive.bytes)

      // engine.env carries the exact minted bearer + the remote-mode contract.
      const envFile = outcome.writtenFiles.get('/home/dana/.vynel/engine.env')?.toString() ?? ''
      const mintedToken = openSecret(masterKey, row?.sealedAuthToken ?? '')
      expect(envFile).toContain(`VYNEL_AUTH_TOKEN=${mintedToken}`)
      expect(envFile).toContain('VYNEL_REMOTE_ENGINE=1')
      expect(envFile).toContain('PORT=18892')
      expect(envFile).toContain('VYNEL_MASTER_KEY_FILE=/home/dana/.vynel/master.key')
      expect(envFile).toContain('VYNEL_APP_VERSION=9.9.9-test')

      const unitFile =
        outcome.writtenFiles.get('/home/dana/.config/systemd/user/vynel-engine.service')?.toString() ?? ''
      expect(unitFile).toContain('ExecStart=/home/dana/.vynel/engine/node')
      expect(unitFile).toContain('EnvironmentFile=/home/dana/.vynel/engine.env')

      // Exec bits restored server-side; linger BEFORE the start (it boots the
      // user manager the start needs); the bus addressed explicitly.
      expect(outcome.executedCommands.some((c) => c.includes('chmod 0755'))).toBe(true)
      const lingerIndex = outcome.executedCommands.findIndex((c) => c.includes('enable-linger'))
      const startIndex = outcome.executedCommands.findIndex((c) =>
        c.includes('enable --now vynel-engine'),
      )
      expect(lingerIndex).toBeGreaterThan(-1)
      expect(startIndex).toBeGreaterThan(lingerIndex)
      expect(outcome.executedCommands[startIndex]).toContain('XDG_RUNTIME_DIR=/run/user/1000')
    })
  })

  it('fails at preflight on a musl server, with the step + an actionable message', async () => {
    await withTestDatabase(async (db) => {
      const archive = makeArchive()
      const outcome = await provisionAgainstFake(db, {
        execHandler: (command) =>
          command.includes('uname -m')
            ? { stdout: DEBIAN_PREFLIGHT.replace(/libc=.*/, 'libc=musl libc Version 1.2.4') }
            : {},
        archive,
      })
      expect(outcome.runError).not.toBeNull()
      const row = findServerInstallById(db, outcome.installId)
      expect(row?.status).toBe('failed')
      expect(row?.step).toBe('preflight')
      expect(row?.errorMessage).toMatch(/glibc|musl/i)
      // Nothing was uploaded to a server that failed preflight.
      expect(outcome.writtenFiles.size).toBe(0)
    })
  })

  it('rejects loudly when the pinned host key does not match', async () => {
    await withTestDatabase(async (db) => {
      const archive = makeArchive()
      const outcome = await provisionAgainstFake(db, {
        execHandler: debianExecHandler(archive.sha256),
        archive,
        pinnedFingerprint: 'PINNED-ELSEWHERE=',
      })
      expect(String(outcome.runError)).toMatch(/host key changed/i)
      const row = findServerInstallById(db, outcome.installId)
      expect(row?.status).toBe('failed')
      expect(row?.step).toBe('connect')
    })
  })

  it('fails when the payload arch does not match the server', async () => {
    await withTestDatabase(async (db) => {
      const archive = makeArchive()
      const outcome = await provisionAgainstFake(db, {
        execHandler: debianExecHandler(archive.sha256),
        archive,
        payloadCpu: 'arm64',
      })
      expect(String(outcome.runError)).toMatch(/x64.*arm64|arm64.*x64/)
      const row = findServerInstallById(db, outcome.installId)
      expect(row?.status).toBe('failed')
      expect(row?.step).toBe('preflight')
    })
  })
})

describe('startServerInstall', () => {
  it('rejects an empty host at the boundary', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      expect(() =>
        startServerInstall(
          db,
          { userId, host: '  ', username: 'dana', credentials: { authKind: 'password', password: 'x' } },
          { masterKeyBase64: masterKey },
        ),
      ).toThrow(/host/i)
    })
  })
})
