// The admin tier override — the hub-side sibling of the platform's
// tier.updated webhook (the portal's fallback when the platform is not
// wired). Same NotFound gate as assignAccountRole: an unknown account is a
// 404, never a silent no-op.

import { NotFoundError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import { findAccountById, setAccountTier } from '@vynel/cloud-db/repositories/accounts'
import type { HubTier } from '@vynel/contracts/hub/entitlements'

export async function assignAccountTier(
  db: CloudDatabase,
  input: {
    readonly accountId: string
    readonly tier: HubTier
    /** Null = the tier never lapses. */
    readonly tierExpiresAt: Date | null
  },
): Promise<void> {
  const account = await findAccountById(db, input.accountId)
  if (account === null) throw new NotFoundError('account', input.accountId)
  await setAccountTier(db, input)
}
