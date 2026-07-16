// Read op — every server the user owns, both scopes (the section filters
// client-side like schedules; the tool shows all — a workspace turn may
// legitimately deploy to a globally-registered server).

import * as sshRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { SshServer } from '../repositories/index.js'

export function listSshServers(db: Database, input: { userId: string }): SshServer[] {
  return sshRepository.listSshServersForUser(db, input.userId)
}
