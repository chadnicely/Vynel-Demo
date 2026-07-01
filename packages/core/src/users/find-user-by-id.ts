// Published read surface — find a user by id (null when absent). Lets ANOTHER
// domain read a user through the users domain's core (not its repo) per the
// data-standard cross-domain rule. The throwing `get*` paths live on the users'
// own routes; this null-safe `find*` is for cross-domain reads (e.g. the
// schedules prompt renderer, which tolerates a missing row).

import type { Database } from '@vynel/db'
import { findUserById as findUserByIdRepo } from '@vynel/db/repositories/users'

export function findUserById(db: Database, userId: string) {
  return findUserByIdRepo(db, userId)
}
