// Shared test seeds + this leaf's canned flavor of the REAL ssh2 loopback
// server (the scriptable server itself lives in @vynel/testing — no mocks;
// the exec path is proven against an actual SSH handshake).

import { randomUUID } from 'node:crypto'
import { startFakeSshServer as startScriptableFakeSshServer, type FakeSshServer } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'

export type { FakeSshServer } from '@vynel/testing'

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

/** This leaf's canned server: password auth 'dana'/'sourdough', every exec
 *  answers 'server says hi' (or echoes back after an "echo-back:" prefix). */
export function startFakeSshServer(): Promise<FakeSshServer> {
  return startScriptableFakeSshServer({
    execHandler: (command) => ({
      stdout: `${
        command.startsWith('echo-back:') ? command.slice('echo-back:'.length) : 'server says hi'
      }\n`,
    }),
  })
}
