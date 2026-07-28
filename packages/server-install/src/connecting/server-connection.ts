// One HELD ssh2 connection for a provisioning run — unlike ssh-servers'
// connect-per-command (fine for occasional single commands), provisioning is
// a pipeline of steps plus a ~200 MB upload, so it opens once (ssh-client.ts
// owns the TOFU connect) and wraps it with exec + sftp.

import type { Client, SFTPWrapper } from 'ssh2'
import { connectSshClient, type SshClientInput } from './ssh-client.js'

const DEFAULT_EXEC_TIMEOUT_MS = 60_000
const OUTPUT_CAP_CHARS = 200_000

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface ServerConnection {
  /** sha256 base64 of the host key this connection actually saw. */
  readonly hostKeyFingerprint: string
  exec(command: string, options?: { timeoutMs?: number }): Promise<ExecResult>
  uploadFile(localPath: string, remotePath: string): Promise<void>
  writeFile(remotePath: string, contents: string, mode: number): Promise<void>
  close(): void
}

export type OpenServerConnectionInput = SshClientInput

export type OpenServerConnection = (input: OpenServerConnectionInput) => Promise<ServerConnection>

export const openServerConnection: OpenServerConnection = async (input) => {
  const { client, hostKeyFingerprint } = await connectSshClient(input)
  return buildConnection(client, hostKeyFingerprint)
}

function buildConnection(connection: Client, hostKeyFingerprint: string): ServerConnection {
  let sftpChannel: SFTPWrapper | null = null
  const sftp = async (): Promise<SFTPWrapper> => {
    if (sftpChannel !== null) return sftpChannel
    sftpChannel = await new Promise<SFTPWrapper>((resolveSftp, rejectSftp) => {
      connection.sftp((error, channel) => (error ? rejectSftp(error) : resolveSftp(channel)))
    })
    return sftpChannel
  }

  return {
    hostKeyFingerprint,

    exec: (command, options) =>
      new Promise<ExecResult>((resolveExec, rejectExec) => {
        connection.exec(command, (error, stream) => {
          if (error) {
            rejectExec(new Error(`exec failed to start — ${error.message}`))
            return
          }
          let stdout = ''
          let stderr = ''
          let settled = false
          const deadline = setTimeout(() => {
            if (settled) return
            settled = true
            stream.close()
            rejectExec(new Error(`Command timed out after ${options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS}ms.`))
          }, options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS)
          stream.on('data', (chunk: Buffer) => {
            if (stdout.length < OUTPUT_CAP_CHARS) stdout += chunk.toString()
          })
          stream.stderr.on('data', (chunk: Buffer) => {
            if (stderr.length < OUTPUT_CAP_CHARS) stderr += chunk.toString()
          })
          stream.on('close', (code: number | undefined) => {
            if (settled) return
            settled = true
            clearTimeout(deadline)
            resolveExec({ stdout, stderr, exitCode: code ?? null })
          })
        })
      }),

    uploadFile: async (localPath, remotePath) => {
      const channel = await sftp()
      await new Promise<void>((resolveUpload, rejectUpload) => {
        channel.fastPut(localPath, remotePath, (error) =>
          error ? rejectUpload(new Error(`Upload to ${remotePath} failed — ${error.message}`)) : resolveUpload(),
        )
      })
    },

    writeFile: async (remotePath, contents, mode) => {
      const channel = await sftp()
      await new Promise<void>((resolveWrite, rejectWrite) => {
        channel.writeFile(remotePath, Buffer.from(contents, 'utf8'), { mode }, (error) =>
          error ? rejectWrite(new Error(`Writing ${remotePath} failed — ${error.message}`)) : resolveWrite(),
        )
      })
    },

    close: () => {
      connection.end()
    },
  }
}
