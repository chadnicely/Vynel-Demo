// The one ssh2 connect for this leaf — TOFU enforced PRE-AUTH in
// hostVerifier, observed fingerprint returned for first-connect pinning.
// Provisioning wraps it with exec/sftp (server-connection.ts); the tunnel
// uses the raw client for port forwarding.

import { createHash } from 'node:crypto'
import { Client } from 'ssh2'
import { ConflictError } from '@vynel/errors'
import type { ServerCredentials } from '../server-install-types.js'

const CONNECT_TIMEOUT_MS = 15_000

export interface SshClientInput {
  host: string
  port: number
  username: string
  credentials: ServerCredentials
  /** null = first connect (trust on first use — the caller records the pin). */
  pinnedHostKeyFingerprint: string | null
}

export function connectSshClient(
  input: SshClientInput,
): Promise<{ client: Client; hostKeyFingerprint: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const client = new Client()
    let observedFingerprint = ''
    let settled = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      client.destroy()
      rejectPromise(error)
    }

    client.on('ready', () => {
      if (settled) return
      settled = true
      resolvePromise({ client, hostKeyFingerprint: observedFingerprint })
    })
    client.on('error', (error) => {
      fail(new Error(`Could not connect to ${input.host}:${input.port} — ${error.message}`))
    })

    client.connect({
      host: input.host,
      port: input.port,
      username: input.username,
      readyTimeout: CONNECT_TIMEOUT_MS,
      // Provisioning and the tunnel both hold the connection across long
      // quiet stretches.
      keepaliveInterval: 15_000,
      ...(input.credentials.authKind === 'password'
        ? { password: input.credentials.password }
        : {
            privateKey: input.credentials.privateKey,
            ...(input.credentials.passphrase !== undefined
              ? { passphrase: input.credentials.passphrase }
              : {}),
          }),
      hostVerifier: (key: Buffer) => {
        observedFingerprint = createHash('sha256').update(key).digest('base64')
        if (
          input.pinnedHostKeyFingerprint !== null &&
          input.pinnedHostKeyFingerprint !== observedFingerprint
        ) {
          fail(
            new ConflictError(
              `The server's host key changed (pinned ${input.pinnedHostKeyFingerprint}, saw ${observedFingerprint}). ` +
                'If the server was reinstalled on purpose, remove this engine install and set it up again; otherwise treat the connection as compromised.',
            ),
          )
          return false
        }
        return true
      },
    })
  })
}
