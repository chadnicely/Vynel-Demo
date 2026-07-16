// One remote command over one connection (connect-per-command v1 — module
// notes). The ONLY place credentials exist in the clear, for the lifetime of
// the connection. Hard timeout + output caps so a hung remote command can
// never hang a turn or flood memory.
//
// Host-key TOFU: the caller passes the pinned fingerprint (null on first
// use); a mismatch REJECTS before authentication ("this server's identity
// changed" — the loud failure non-technical users need), and the observed
// fingerprint always rides the result/error so the caller can pin it.

import { createHash } from 'node:crypto'
import { Client } from 'ssh2'
import type { SshCommandResult, SshCredentials } from '../ssh-types.js'

const DEFAULT_TIMEOUT_MS = 60_000
const CONNECT_TIMEOUT_MS = 15_000
const OUTPUT_CAP_CHARS = 200_000

export class SshHostKeyMismatchError extends Error {
  constructor(
    readonly expectedFingerprint: string,
    readonly observedFingerprint: string,
  ) {
    super('The server presented a DIFFERENT identity than the one on record.')
  }
}

export interface ExecuteSshCommandInput {
  host: string
  port: number
  username: string
  credentials: SshCredentials
  command: string
  pinnedHostKeyFingerprint: string | null
  timeoutMs?: number
}

export function executeSshCommand(input: ExecuteSshCommandInput): Promise<SshCommandResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise<SshCommandResult>((resolvePromise, rejectPromise) => {
    const connection = new Client()
    let observedFingerprint = ''
    let settled = false

    const settle = (outcome: { ok: SshCommandResult } | { err: Error }): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      connection.end()
      if ('ok' in outcome) resolvePromise(outcome.ok)
      else rejectPromise(outcome.err)
    }

    const deadline = setTimeout(() => {
      settle({
        err: new Error(
          `The command did not finish within ${Math.round(timeoutMs / 1000)}s and was cut off.`,
        ),
      })
      // settle()'s polite end() can linger on a wedged transport — the
      // timeout path tears the socket down for real.
      connection.destroy()
    }, timeoutMs)

    connection.on('error', (err) => settle({ err }))
    connection.on('ready', () => {
      connection.exec(input.command, (execErr, stream) => {
        if (execErr) return settle({ err: execErr })
        let stdout = ''
        let stderr = ''
        stream.on('data', (chunk: Buffer) => {
          if (stdout.length < OUTPUT_CAP_CHARS) stdout += chunk.toString('utf8')
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          if (stderr.length < OUTPUT_CAP_CHARS) stderr += chunk.toString('utf8')
        })
        stream.on('close', (code: number | null | undefined) => {
          settle({
            ok: {
              // ssh2 omits the code entirely when the remote never sent
              // exit-status (signal kill, abrupt close) — normalize to null so
              // the declared `number | null` holds in results AND payloads.
              exitCode: code ?? null,
              stdout: stdout.slice(0, OUTPUT_CAP_CHARS),
              stderr: stderr.slice(0, OUTPUT_CAP_CHARS),
              stdoutTruncated: stdout.length >= OUTPUT_CAP_CHARS,
              stderrTruncated: stderr.length >= OUTPUT_CAP_CHARS,
              hostKeyFingerprint: observedFingerprint,
            },
          })
        })
      })
    })

    connection.connect({
      host: input.host,
      port: input.port,
      username: input.username,
      readyTimeout: CONNECT_TIMEOUT_MS,
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
          settle({
            err: new SshHostKeyMismatchError(input.pinnedHostKeyFingerprint, observedFingerprint),
          })
          return false
        }
        return true
      },
    })
  })
}
