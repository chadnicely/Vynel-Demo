// Core op — register a server. The credential arrives ONCE, is sealed
// immediately against the master key, and the returned row is the only thing
// that ever leaves (serializers strip the blob anyway). Insert +
// `ssh.server-added` co-commit in ONE transaction. sync.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ConflictError, ValidationError } from '@vynel/errors'
import * as sshRepository from '../repositories/index.js'
import { sealSecret } from '../sealing/seal-secret.js'
import { SSH_SERVER_ADDED, type SshServerAddedPayload } from '../ssh-events.js'
import type { Database } from '@vynel/db'
import type { SshServer } from '../repositories/index.js'
import type { SshCredentials, StructuralLogger } from '../ssh-types.js'

export interface AddSshServerInput {
  userId: string
  workspaceId: string | null // null = GLOBAL scope
  name: string
  host: string
  port?: number
  username: string
  credentials: SshCredentials
}

export function addSshServer(
  db: Database,
  input: AddSshServerInput,
  deps: { masterKeyBase64: string; logger?: StructuralLogger },
): SshServer {
  const name = input.name.trim()
  if (name.length === 0 || name.length > 60) {
    throw new ValidationError('The server needs a name (up to 60 characters).')
  }
  const host = input.host.trim()
  if (host.length === 0 || host.length > 253 || /\s/.test(host)) {
    throw new ValidationError('The host must be a hostname or IP address.')
  }
  const username = input.username.trim()
  if (username.length === 0 || username.length > 64) {
    throw new ValidationError('The sign-in username is required.')
  }
  const port = input.port ?? 22
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ValidationError('The port must be a number between 1 and 65535.')
  }
  const secretValue =
    input.credentials.authKind === 'password'
      ? input.credentials.password
      : input.credentials.privateKey
  if (secretValue.trim().length === 0) {
    throw new ValidationError(
      input.credentials.authKind === 'password'
        ? 'The password is required.'
        : 'The private key is required.',
    )
  }
  if (sshRepository.findSshServerByName(db, { userId: input.userId, name })) {
    throw new ConflictError(`You already have a server named "${name}".`)
  }

  const now = new Date()
  const server = withTransaction(db, (tx) => {
    const inserted = sshRepository.insertSshServer(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      name,
      host,
      port,
      username,
      authKind: input.credentials.authKind,
      encryptedCredentials: sealSecret(deps.masterKeyBase64, JSON.stringify(input.credentials)),
      hostKeyFingerprint: null,
      lastConnectedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: SshServerAddedPayload = {
      serverId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      name: inserted.name,
      host: inserted.host,
      addedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SSH_SERVER_ADDED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  // The credential NEVER enters a log line — ids and names only.
  deps.logger?.info({ serverId: server.id, name: server.name }, 'ssh server added')
  return server
}
