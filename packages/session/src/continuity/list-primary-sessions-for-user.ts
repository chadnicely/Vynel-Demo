// `listPrimarySessionsForUser` (core) — the PUBLISHED read surface for a user's
// live primary sessions. The `monitor` aggregator reads primaries THROUGH this core op,
// never the `session-continuity` repo directly (data-standard "Cross-domain
// communication": no directly-imported cross-domain repo). A thin wrapper over
// the domain's own repo — a domain's core wrapping its own repo is the normal
// layering; what the rule forbids is ANOTHER domain reaching the repo.

import type { Database } from '@vynel/db'
import {
  listPrimarySessionsForUser as listPrimarySessionsForUserRepo,
  type PrimarySessionRow,
} from '../repositories/index.js'

export function listPrimarySessionsForUser(db: Database, userId: string): PrimarySessionRow[] {
  return listPrimarySessionsForUserRepo(db, userId)
}
