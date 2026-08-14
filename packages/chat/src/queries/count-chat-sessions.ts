// Core op — how many sessions the library lists for one scope. Feeds the
// drilled section menu's `Sessions 13` count (workspace redesign, the
// canvas's per-row counts). `workspaceId: null` = the Global tab, which
// lists every scope's sessions.

import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'

export type CountChatSessionsInput = {
  userId: string
  workspaceId: string | null
}

export function countChatSessions(db: Database, input: CountChatSessionsInput): number {
  return chatRepository.countChatSessions(db, input)
}
