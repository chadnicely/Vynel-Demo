// Shared test seeds + the in-process REAL ssh2 server (no mocks — the exec
// path is proven against an actual SSH handshake on a loopback port).

import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { Server, type Connection } from 'ssh2'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'

export { insertSshServer, findSshServerById } from './repositories/index.js'
export type { NewSshServer } from './repositories/index.js'

export function seedUserWorkspace(db: Database): { userId: string; workspaceId: string } {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { userId: user.id, workspaceId: workspace.id }
}

export interface FakeSshServer {
  port: number
  close(): Promise<void>
}

/** A real ssh2 loopback server: accepts password auth 'dana'/'sourdough',
 *  answers every exec with a canned stdout + exit 0 (or echoes the command
 *  back when it starts with "echo-back:"). */
export function startFakeSshServer(): Promise<FakeSshServer> {
  const hostKeyPem = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  }).privateKey

  const server = new Server({ hostKeys: [hostKeyPem] }, (client: Connection) => {
    client
      .on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === 'dana' && ctx.password === 'sourdough') {
          ctx.accept()
        } else if (ctx.method === 'password') {
          ctx.reject()
        } else {
          ctx.reject(['password'])
        }
      })
      .on('ready', () => {
        client.on('session', (acceptSession) => {
          const session = acceptSession()
          session.on('exec', (acceptExec, _reject, info) => {
            const stream = acceptExec()
            const reply = info.command.startsWith('echo-back:')
              ? info.command.slice('echo-back:'.length)
              : 'server says hi'
            stream.write(`${reply}\n`)
            stream.exit(0)
            stream.end()
          })
        })
      })
      .on('error', () => {
        // A client aborting mid-handshake (the mismatch test) is expected.
      })
  })

  return new Promise((resolveStarted) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolveStarted({
        port,
        close: () =>
          new Promise<void>((resolveClosed) => {
            server.close(() => resolveClosed())
          }),
      })
    })
  })
}
