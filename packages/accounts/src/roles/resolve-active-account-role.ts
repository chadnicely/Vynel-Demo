// The caller's LIVE role, read FRESH from the accounts table — authority is
// never taken from the ~7-day token claim (the tier precedent, applied to
// admin power: a demoted or disabled admin loses the surface on their next
// request, not at token expiry). Null = no active account stands behind the
// token — treat as no authority at all.

import type { CloudDatabase } from '@vynel/cloud-db'
import { findAccountById, type AccountRole } from '@vynel/cloud-db/repositories/accounts'

export async function resolveActiveAccountRole(
  db: CloudDatabase,
  accountId: string,
): Promise<AccountRole | null> {
  const account = await findAccountById(db, accountId)
  if (account === null || account.status !== 'active') return null
  return account.role === 'admin' ? 'admin' : 'member'
}
