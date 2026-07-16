// End-to-end over a REAL loopback ssh2 server: seal → add → run → the
// credential opens only inside the exec path, TOFU pins on first connect and
// bites on a changed host key. No mocks anywhere.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { seedUserWorkspace, startFakeSshServer, type FakeSshServer } from '../test-support.js'
import { addSshServer } from '../lifecycle/add-ssh-server.js'
import { runServerCommand } from './run-server-command.js'
import { SshHostKeyMismatchError } from './execute-ssh-command.js'
import { findSshServerById } from '../repositories/index.js'
import { SSH_COMMAND_EXECUTED } from '../ssh-events.js'

const masterKey = randomBytes(32).toString('base64')
let sshd: FakeSshServer

beforeAll(async () => {
  sshd = await startFakeSshServer()
})
afterAll(async () => {
  await sshd.close()
})

function addServer(db: Parameters<typeof addSshServer>[0], userId: string, workspaceId: string) {
  return addSshServer(
    db,
    {
      userId,
      workspaceId,
      name: 'Test box',
      host: '127.0.0.1',
      port: sshd.port,
      username: 'dana',
      credentials: { authKind: 'password', password: 'sourdough' },
    },
    { masterKeyBase64: masterKey },
  )
}

describe('runServerCommand', () => {
  it('runs the command, pins the host key, stamps lastConnectedAt, publishes the fact', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const server = addServer(db, userId, workspaceId)
      expect(server.hostKeyFingerprint).toBeNull()
      // The sealed blob never contains the password.
      expect(server.encryptedCredentials).not.toContain('sourdough')

      const result = await runServerCommand(
        db,
        { serverId: server.id, userId, command: 'echo-back:disk is fine', description: 'Check disk space' },
        { masterKeyBase64: masterKey },
      )
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('disk is fine')

      const after = findSshServerById(db, server.id)!
      expect(after.hostKeyFingerprint).toBe(result.hostKeyFingerprint)
      expect(after.lastConnectedAt).not.toBeNull()

      const events = listOutboxEventsByType(db, SSH_COMMAND_EXECUTED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as { description: string }
      expect(payload.description).toBe('Check disk space')
      // Neither the raw command nor the credential enters the payload.
      expect(JSON.stringify(events[0]!.payload)).not.toContain('echo-back')
      expect(JSON.stringify(events[0]!.payload)).not.toContain('sourdough')
    })
  })

  it('a changed host key REJECTS loudly (TOFU pin bites)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const server = addServer(db, userId, workspaceId)
      // Pin a bogus fingerprint as if a different machine had been trusted.
      const { updateSshServer } = await import('../repositories/index.js')
      updateSshServer(db, server.id, { hostKeyFingerprint: 'bogus-pin' })

      await expect(
        runServerCommand(
          db,
          { serverId: server.id, userId, command: 'echo-back:x', description: 'Check' },
          { masterKeyBase64: masterKey },
        ),
      ).rejects.toThrow(SshHostKeyMismatchError)
    })
  })

  it("404s identically on missing and another user's server", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const server = addServer(db, userId, workspaceId)

      await expect(
        runServerCommand(
          db,
          { serverId: 'missing', userId, command: 'x', description: 'Check it' },
          { masterKeyBase64: masterKey },
        ),
      ).rejects.toThrow(NotFoundError)
      await expect(
        runServerCommand(
          db,
          { serverId: server.id, userId: other.userId, command: 'x', description: 'Check it' },
          { masterKeyBase64: masterKey },
        ),
      ).rejects.toThrow(NotFoundError)
    })
  })
})
