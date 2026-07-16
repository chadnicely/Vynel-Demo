import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import { addSshServer } from './add-ssh-server.js'
import { removeSshServer } from './remove-ssh-server.js'
import { findSshServerById } from '../repositories/index.js'
import { SSH_SERVER_ADDED, SSH_SERVER_REMOVED } from '../ssh-events.js'

const masterKey = randomBytes(32).toString('base64')

describe('addSshServer / removeSshServer', () => {
  it('seals the credential, defaults port 22, co-commits ssh.server-added (no secret anywhere)', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const server = addSshServer(
        db,
        {
          userId,
          workspaceId: null, // global scope
          name: 'My web server',
          host: 'example.com',
          username: 'root',
          credentials: { authKind: 'password', password: 'hunter2' },
        },
        { masterKeyBase64: masterKey },
      )
      expect(server.port).toBe(22)
      expect(server.workspaceId).toBeNull()
      expect(server.encryptedCredentials).not.toContain('hunter2')

      const events = listOutboxEventsByType(db, SSH_SERVER_ADDED)
      expect(events).toHaveLength(1)
      expect(JSON.stringify(events[0]!.payload)).not.toContain('hunter2')
    })
  })

  it('rejects duplicates (case-insensitive), bad hosts, empty secrets', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const base = {
        userId,
        workspaceId,
        name: 'Box',
        host: 'example.com',
        username: 'root',
        credentials: { authKind: 'password', password: 'x' } as const,
      }
      addSshServer(db, base, { masterKeyBase64: masterKey })
      expect(() =>
        addSshServer(db, { ...base, name: 'BOX' }, { masterKeyBase64: masterKey }),
      ).toThrow(ConflictError)
      expect(() =>
        addSshServer(db, { ...base, name: 'B2', host: 'bad host' }, { masterKeyBase64: masterKey }),
      ).toThrow(ValidationError)
      expect(() =>
        addSshServer(
          db,
          { ...base, name: 'B3', credentials: { authKind: 'password', password: '  ' } },
          { masterKeyBase64: masterKey },
        ),
      ).toThrow(ValidationError)
    })
  })

  it('remove hard-deletes (the blob dies with the row) + co-commits; identical 404s', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const server = addSshServer(
        db,
        {
          userId,
          workspaceId,
          name: 'Box',
          host: 'example.com',
          username: 'root',
          credentials: { authKind: 'password', password: 'x' },
        },
        { masterKeyBase64: masterKey },
      )

      expect(() => removeSshServer(db, { serverId: server.id, userId: other.userId })).toThrow(
        NotFoundError,
      )
      removeSshServer(db, { serverId: server.id, userId })
      expect(findSshServerById(db, server.id)).toBeNull()
      expect(listOutboxEventsByType(db, SSH_SERVER_REMOVED)).toHaveLength(1)
      expect(() => removeSshServer(db, { serverId: server.id, userId })).toThrow(NotFoundError)
    })
  })
})
