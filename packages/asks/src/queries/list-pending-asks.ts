// Read op — the user's pending asks (newest first), the UI poll's input.

import * as asksRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { AskRequest } from '../repositories/index.js'

export function listPendingAsks(db: Database, input: { userId: string }): AskRequest[] {
  return asksRepository.listPendingAskRequestsForUser(db, input.userId)
}
