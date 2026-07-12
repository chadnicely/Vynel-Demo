// Enable/disable an account — the ONE home for the disable rule (the
// platform's user.removed webhook and the admin portal both land here):
// disabling must also revoke every device session, so a disabled account
// can't keep minting access tokens; role/tier reads already refuse
// non-active accounts fresh, so existing tokens die on their next request.

import { NotFoundError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import {
  findAccountById,
  setAccountStatus,
  type AccountStatus,
} from '@vynel/cloud-db/repositories/accounts'
import { revokeAllRefreshTokensForAccount } from '../repositories/refresh-tokens/index.js'

export async function setAccountLifecycleStatus(
  db: CloudDatabase,
  input: {
    readonly accountId: string
    readonly status: AccountStatus
    readonly now?: Date
  },
): Promise<void> {
  const account = await findAccountById(db, input.accountId)
  if (account === null) throw new NotFoundError('account', input.accountId)
  await setAccountStatus(db, { accountId: input.accountId, status: input.status })
  if (input.status === 'disabled') {
    await revokeAllRefreshTokensForAccount(db, {
      accountId: input.accountId,
      revokedAt: input.now ?? new Date(),
    })
  }
}
