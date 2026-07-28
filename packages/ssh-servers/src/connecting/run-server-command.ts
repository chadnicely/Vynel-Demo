// Core op — the run tool's whole path: load the row (owner-scoped), open the
// sealed credential (only here, only for the connection's lifetime), execute
// with the TOFU pin, then record the connection facts (fingerprint pin on
// first use + lastConnectedAt) and publish `ssh.command-executed` (the
// plain-language description — never the raw command — rides the payload).

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as sshRepository from '../repositories/index.js'
import { openSecret } from '@vynel/sealing'
import { executeSshCommand } from './execute-ssh-command.js'
import { SSH_COMMAND_EXECUTED, type SshCommandExecutedPayload } from '../ssh-events.js'
import type { Database } from '@vynel/db'
import type { SshCommandResult, SshCredentials, StructuralLogger } from '../ssh-types.js'

export interface RunServerCommandInput {
  serverId: string
  userId: string
  command: string
  description: string
}

export async function runServerCommand(
  db: Database,
  input: RunServerCommandInput,
  deps: { masterKeyBase64: string; logger?: StructuralLogger },
): Promise<SshCommandResult> {
  const server = sshRepository.findSshServerById(db, input.serverId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!server || server.userId !== input.userId) {
    throw new NotFoundError('ssh-server', input.serverId)
  }

  const credentials = JSON.parse(
    openSecret(deps.masterKeyBase64, server.encryptedCredentials),
  ) as SshCredentials

  const result = await executeSshCommand({
    host: server.host,
    port: server.port,
    username: server.username,
    credentials,
    command: input.command,
    pinnedHostKeyFingerprint: server.hostKeyFingerprint,
  })

  const now = new Date()
  withTransaction(db, (tx) => {
    sshRepository.updateSshServer(tx, server.id, {
      lastConnectedAt: now,
      updatedAt: now,
      // TOFU: pin on first successful connect; already-pinned stays (a
      // mismatch never reaches here — executeSshCommand rejects first).
      ...(server.hostKeyFingerprint === null
        ? { hostKeyFingerprint: result.hostKeyFingerprint }
        : {}),
    })
    const payload: SshCommandExecutedPayload = {
      serverId: server.id,
      userId: server.userId,
      workspaceId: server.workspaceId,
      name: server.name,
      description: input.description,
      exitCode: result.exitCode,
      executedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SSH_COMMAND_EXECUTED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info(
    { serverId: server.id, exitCode: result.exitCode },
    'ssh command executed',
  )
  return result
}
