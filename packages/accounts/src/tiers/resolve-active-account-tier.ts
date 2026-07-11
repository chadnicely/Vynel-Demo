// The caller's LIVE tier, read FRESH from the accounts table — never the
// (~7-day-stale) entitlement/access token claim. The highest-stakes staleness
// spot is paid content: a downgraded or disabled account must lose access on
// its next request, not at token expiry. Null = no active account stands
// behind the token (deleted/disabled) — the caller decides fail-open (browse)
// vs fail-closed (download).

import type { CloudDatabase } from '@vynel/cloud-db'
import { findAccountById } from '@vynel/cloud-db/repositories/accounts'
import type { HubTier } from '@vynel/contracts/hub/entitlements'
import { resolveEffectiveTier } from '../tokens/entitlement-token.js'

export async function resolveActiveAccountTier(
  db: CloudDatabase,
  accountId: string,
  now: Date,
): Promise<HubTier | null> {
  const account = await findAccountById(db, accountId)
  if (account === null || account.status !== 'active') return null
  return resolveEffectiveTier(account.tier, account.tierExpiresAt, now)
}
