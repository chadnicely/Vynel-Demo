// Core op — remove a server (owner-scoped). Hard delete: the sealed blob
// dies with the row (rotation = remove + re-add; there is no update surface
// by construction). Delete + `ssh.server-removed` co-commit in ONE tx.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as sshRepository from '../repositories/index.js'
import { SSH_SERVER_REMOVED, type SshServerRemovedPayload } from '../ssh-events.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../ssh-types.js'

export function removeSshServer(
  db: Database,
  input: { serverId: string; userId: string },
  deps: { logger?: StructuralLogger } = {},
): void {
  const server = sshRepository.findSshServerById(db, input.serverId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!server || server.userId !== input.userId) {
    throw new NotFoundError('ssh-server', input.serverId)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    sshRepository.hardDeleteSshServer(tx, server.id)
    const payload: SshServerRemovedPayload = {
      serverId: server.id,
      userId: server.userId,
      workspaceId: server.workspaceId,
      name: server.name,
      removedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SSH_SERVER_REMOVED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ serverId: server.id }, 'ssh server removed')
}
