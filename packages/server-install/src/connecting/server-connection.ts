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

/** A live PTY-backed command — the shape an interactive CLI needs (it prints a
 *  prompt and blocks on stdin, so the channel must outlive one round-trip). */
export interface InteractiveSession {
  /** Everything the command has printed so far (ANSI stripped). */
  readonly output: () => string
  /** Send a line to the command's stdin (newline appended). */
  writeLine(line: string): void
  /** Resolves when the command exits; null exit = killed/disconnected. */
  readonly finished: Promise<number | null>
  close(): void
}

export interface ServerConnection {
  /** sha256 base64 of the host key this connection actually saw. */
  readonly hostKeyFingerprint: string
  exec(command: string, options?: { timeoutMs?: number }): Promise<ExecResult>
  /** Run a command on a PTY and keep it alive for back-and-forth. */
  execInteractive(command: string): Promise<InteractiveSession>
  uploadFile(localPath: string, remotePath: string): Promise<void>
  writeFile(remotePath: string, contents: string, mode: number): Promise<void>
  close(): void
}

// Interactive CLIs paint with escape sequences; the caller matches on plain
// text (a URL, a prompt), so strip them once at the edge.
const ANSI_PATTERN = /\[[0-9;?]*[a-zA-Z]/g

function stripAnsi(raw: string): string {
  return raw.replace(ANSI_PATTERN, '')
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

    execInteractive: (command) =>
      new Promise<InteractiveSession>((resolveSession, rejectSession) => {
        // pty: true is the whole point — `claude auth login` refuses to run a
        // browser-authorization flow on a bare pipe.
        connection.exec(command, { pty: true }, (error, stream) => {
          if (error) {
            rejectSession(new Error(`could not start "${command}" — ${error.message}`))
            return
          }
          let output = ''
          const append = (chunk: Buffer): void => {
            output += stripAnsi(chunk.toString())
            if (output.length > OUTPUT_CAP_CHARS) output = output.slice(-OUTPUT_CAP_CHARS)
          }
          stream.on('data', append)
          stream.stderr.on('data', append)
          const finished = new Promise<number | null>((resolveFinished) => {
            stream.on('close', (code: number | undefined) => resolveFinished(code ?? null))
          })
          resolveSession({
            output: () => output,
            writeLine: (line) => stream.write(`${line}\n`),
            finished,
            close: () => stream.close(),
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
