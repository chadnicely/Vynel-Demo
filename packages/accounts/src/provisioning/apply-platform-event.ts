// Applies ONE platform webhook event (cloud-api.md §4 — WE author the
// contract; the platform adapts). Idempotent by construction: every handler
// converges on the same end state when replayed. `platformUserId` is the
// join key; user.created for a known id degrades to an update (the retrying
// platform must never see a 409).

import { ConflictError, ForbiddenError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import {
  findAccountByPlatformUserId,
  setAccountStatus,
  setAccountTier,
  updateAccountDisplayName,
  updateAccountEmail,
} from '@vynel/cloud-db/repositories/accounts'
import { revokeAllRefreshTokensForAccount } from '../repositories/refresh-tokens/index.js'
import { createProvisionedAccount } from './create-account.js'
import { isUniqueViolation } from './unique-violation.js'
import type { SetPasswordLinkDeps } from '../credentials/set-password-links.js'

export interface PlatformUserEvent {
  readonly type: 'user.created' | 'user.updated' | 'user.removed' | 'tier.updated'
  readonly platformUserId: string
  readonly email?: string
  readonly displayName?: string
  readonly tier?: string
  /** ISO datetime; null/absent = no expiry. */
  readonly tierExpiresAt?: string | null
}

export interface ApplyPlatformEventResult {
  readonly outcome: 'created' | 'updated' | 'removed' | 'ignored'
  readonly accountId: string | null
}

export async function applyPlatformEvent(
  db: CloudDatabase,
  event: PlatformUserEvent,
  deps: SetPasswordLinkDeps,
): Promise<ApplyPlatformEventResult> {
  const existing = await findAccountByPlatformUserId(db, event.platformUserId)
  const now = deps.now?.() ?? new Date()
  const tierExpiresAt =
    event.tierExpiresAt === undefined || event.tierExpiresAt === null
      ? null
      : new Date(event.tierExpiresAt)

  switch (event.type) {
    case 'user.created': {
      if (existing !== null) {
        // Replay/duplicate: converge like an update instead of erroring.
        await applyProfile(db, existing.id, event)
        return { outcome: 'updated', accountId: existing.id }
      }
      if (event.email === undefined || event.displayName === undefined) {
        throw new ForbiddenError('user.created requires email and displayName.')
      }
      const { accountId } = await createProvisionedAccount(
        db,
        {
          email: event.email,
          displayName: event.displayName,
          platformUserId: event.platformUserId,
        },
        deps,
      )
      if (event.tier !== undefined) {
        await setAccountTier(db, { accountId, tier: event.tier, tierExpiresAt })
      }
      return { outcome: 'created', accountId }
    }
    case 'user.updated': {
      if (existing === null) return { outcome: 'ignored', accountId: null }
      await applyProfile(db, existing.id, event)
      return { outcome: 'updated', accountId: existing.id }
    }
    case 'tier.updated': {
      if (existing === null) return { outcome: 'ignored', accountId: null }
      if (event.tier !== undefined) {
        await setAccountTier(db, { accountId: existing.id, tier: event.tier, tierExpiresAt })
      }
      return { outcome: 'updated', accountId: existing.id }
    }
    case 'user.removed': {
      if (existing === null) return { outcome: 'ignored', accountId: null }
      // Disable + kill every device session: the next boot check locks the
      // desktop (the revocation moment). The row stays for audit/re-grant.
      await setAccountStatus(db, { accountId: existing.id, status: 'disabled' })
      await revokeAllRefreshTokensForAccount(db, { accountId: existing.id, revokedAt: now })
      return { outcome: 'removed', accountId: existing.id }
    }
  }
}

async function applyProfile(
  db: CloudDatabase,
  accountId: string,
  event: PlatformUserEvent,
): Promise<void> {
  if (event.displayName !== undefined) {
    await updateAccountDisplayName(db, { accountId, displayName: event.displayName })
  }
  if (event.email !== undefined) {
    try {
      await updateAccountEmail(db, { accountId, email: event.email })
    } catch (error) {
      // The platform sent an email that already belongs to another account —
      // a real conflict worth surfacing (the platform should fix its side),
      // not a silent drop.
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Another account already uses ${event.email.toLowerCase()}.`)
      }
      throw error
    }
  }
  if (event.tier !== undefined) {
    await setAccountTier(db, {
      accountId,
      tier: event.tier,
      tierExpiresAt:
        event.tierExpiresAt === undefined || event.tierExpiresAt === null
          ? null
          : new Date(event.tierExpiresAt),
    })
  }
  // A `user.removed` account that gets updated again stays disabled — only a
  // deliberate re-provisioning flow should resurrect it (M3 keeps this
  // conservative; revisit with the platform's real lifecycle).
}
