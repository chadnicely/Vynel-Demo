// Register a remote-engine install: validate at the boundary, seal the
// credential AND a freshly minted bearer (the remote daemon's VYNEL_AUTH_TOKEN
// — the D3 tunnel opens it to inject the Authorization header), insert +
// `server-install.started` co-committed in ONE transaction. The caller kicks
// `runProvision` separately (fire-and-track).

import { randomBytes, randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { sealSecret } from '@vynel/sealing'
import * as installsRepository from '../repositories/index.js'
import type { ServerInstall } from '../repositories/index.js'
import { SERVER_INSTALL_STARTED, type ServerInstallStartedPayload } from '../server-install-events.js'
import type { ServerCredentials, StructuralLogger } from '../server-install-types.js'

export interface StartServerInstallInput {
  userId: string
  host: string
  port?: number
  username: string
  credentials: ServerCredentials
}

export function startServerInstall(
  db: Database,
  input: StartServerInstallInput,
  deps: { masterKeyBase64: string; logger?: StructuralLogger },
): ServerInstall {
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
    input.credentials.authKind === 'password' ? input.credentials.password : input.credentials.privateKey
  if (secretValue.trim().length === 0) {
    throw new ValidationError(
      input.credentials.authKind === 'password' ? 'The password is required.' : 'The private key is required.',
    )
  }

  const now = new Date()
  const install = withTransaction(db, (tx) => {
    const inserted = installsRepository.insertServerInstall(tx, {
      id: randomUUID(),
      userId: input.userId,
      host,
      port,
      username,
      authKind: input.credentials.authKind,
      encryptedCredentials: sealSecret(deps.masterKeyBase64, JSON.stringify(input.credentials)),
      sealedAuthToken: sealSecret(deps.masterKeyBase64, randomBytes(32).toString('base64url')),
      hostKeyFingerprint: null,
      status: 'provisioning',
      step: null,
      errorMessage: null,
      installedVersion: null,
      lastHealthyAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: ServerInstallStartedPayload = {
      installId: inserted.id,
      userId: inserted.userId,
      host: inserted.host,
      startedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SERVER_INSTALL_STARTED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })
  deps.logger?.info({ installId: install.id, host: install.host }, 'server install started')
  return install
}
