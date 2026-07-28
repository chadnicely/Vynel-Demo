// A REAL ssh2 loopback server for tests (no mocks — connection code is proven
// against an actual SSH handshake). Scriptable: the caller decides auth, what
// every exec answers, and whether the write-only SFTP subsystem is on (enough
// for fastPut/writeFile — uploads land in `writtenFiles` for assertions).
// Shared here because two leaves (ssh-servers, server-install) prove their
// connection paths against it.

import { generateKeyPairSync } from 'node:crypto'
import { connect } from 'node:net'
// Default-import interop: ssh2 is CJS and node's named-export lexer misses
// `Server`/`utils` under tsx (vitest's transform tolerated it; node does not).
import ssh2 from 'ssh2'
import type { Connection } from 'ssh2'

const { Server, utils } = ssh2

export interface FakeSshExecReply {
  stdout?: string
  stderr?: string
  exitCode?: number
}

export interface FakeSshServerOptions {
  username?: string
  password?: string
  /** Answer for each exec; default = 'server says hi', exit 0. */
  execHandler?: (command: string) => FakeSshExecReply
  /** Accept SFTP sessions (write-only) — uploads collect in `writtenFiles`. */
  enableSftp?: boolean
  /** Accept direct-tcpip channels, connecting to the requested destination
   *  port on loopback (the tunnel tests' "remote daemon" runs there). */
  enableForwarding?: boolean
}

export interface FakeSshServer {
  port: number
  /** Every command the clients ran, in order. */
  executedCommands: string[]
  /** SFTP-written files by remote path (assembled on CLOSE). */
  writtenFiles: Map<string, Buffer>
  /** Drop every live client connection (reconnect tests) — the listener stays up. */
  dropConnections(): void
  close(): Promise<void>
}

const SFTP_OK = utils.sftp.STATUS_CODE.OK
const SFTP_FAILURE = utils.sftp.STATUS_CODE.FAILURE

export function startFakeSshServer(options: FakeSshServerOptions = {}): Promise<FakeSshServer> {
  const username = options.username ?? 'dana'
  const password = options.password ?? 'sourdough'
  const execHandler: (command: string) => FakeSshExecReply =
    options.execHandler ?? (() => ({ stdout: 'server says hi\n' }))
  const executedCommands: string[] = []
  const writtenFiles = new Map<string, Buffer>()
  const liveConnections = new Set<Connection>()

  const hostKeyPem = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  }).privateKey

  const server = new Server({ hostKeys: [hostKeyPem] }, (client: Connection) => {
    liveConnections.add(client)
    client.on('close', () => liveConnections.delete(client))
    client
      .on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === username && ctx.password === password) {
          ctx.accept()
        } else if (ctx.method === 'password') {
          ctx.reject()
        } else {
          ctx.reject(['password'])
        }
      })
      .on('ready', () => {
        if (options.enableForwarding === true) {
          client.on('tcpip', (acceptChannel, _rejectChannel, info) => {
            const channel = acceptChannel()
            const target = connect(info.destPort, '127.0.0.1')
            target.on('connect', () => {
              channel.pipe(target)
              target.pipe(channel)
            })
            const teardown = (): void => {
              channel.end()
              target.destroy()
            }
            target.on('error', teardown)
            channel.on('close', teardown)
          })
        }
        client.on('session', (acceptSession) => {
          const session = acceptSession()
          session.on('exec', (acceptExec, _reject, info) => {
            executedCommands.push(info.command)
            const stream = acceptExec()
            const reply = execHandler(info.command)
            if (reply.stdout !== undefined) stream.write(reply.stdout)
            if (reply.stderr !== undefined) stream.stderr.write(reply.stderr)
            stream.exit(reply.exitCode ?? 0)
            stream.end()
          })
          if (options.enableSftp === true) {
            session.on('sftp', (acceptSftp) => {
              const sftp = acceptSftp()
              // Write-only subset: handles are the remote path itself; WRITE
              // chunks collect per handle and assemble on CLOSE. Enough for
              // ssh2's fastPut/writeFile client calls, nothing more.
              const openChunks = new Map<string, { offset: number; data: Buffer }[]>()
              let nextHandleId = 0
              const handlePaths = new Map<string, string>()
              sftp.on('OPEN', (reqid, filename) => {
                const handle = Buffer.from(`h${nextHandleId++}`)
                handlePaths.set(handle.toString(), filename)
                openChunks.set(filename, [])
                sftp.handle(reqid, handle)
              })
              sftp.on('WRITE', (reqid, handle, offset, data) => {
                const filename = handlePaths.get(handle.toString())
                if (filename === undefined) {
                  sftp.status(reqid, SFTP_FAILURE)
                  return
                }
                openChunks.get(filename)?.push({ offset, data: Buffer.from(data) })
                sftp.status(reqid, SFTP_OK)
              })
              sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, SFTP_OK))
              sftp.on('SETSTAT', (reqid) => sftp.status(reqid, SFTP_OK))
              sftp.on('CLOSE', (reqid, handle) => {
                const filename = handlePaths.get(handle.toString())
                if (filename !== undefined) {
                  const chunks = openChunks.get(filename) ?? []
                  const size = chunks.reduce((max, c) => Math.max(max, c.offset + c.data.length), 0)
                  const assembled = Buffer.alloc(size)
                  for (const chunk of chunks) chunk.data.copy(assembled, chunk.offset)
                  writtenFiles.set(filename, assembled)
                }
                sftp.status(reqid, SFTP_OK)
              })
            })
          }
        })
      })
      .on('error', () => {
        // A client aborting mid-handshake (host-key mismatch tests) is expected.
      })
  })

  return new Promise((resolveStarted) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolveStarted({
        port,
        executedCommands,
        writtenFiles,
        dropConnections: () => {
          for (const connection of liveConnections) connection.end()
        },
        close: () =>
          new Promise<void>((resolveClosed) => {
            server.close(() => resolveClosed())
          }),
      })
    })
  })
}
