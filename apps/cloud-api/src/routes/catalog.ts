// The marketplace catalog surface (browse + detail + download). Both reads
// require the access token; the caller's tier is looked up FRESH from the
// accounts table on every request — never the (~7-day-stale) token claim.
//
// Browse/detail are fail-OPEN (a gone account browses as basic); the download
// is fail-CLOSED (no live active account, or tier below the item's minimum →
// denied). That asymmetry is the §5 "browse generous, install gated" line.

import { Hono } from 'hono'
import { NotFoundError, VynelError } from '@vynel/errors'
import { resolveEffectiveTier } from '@vynel/accounts'
import { findAccountById } from '@vynel/cloud-db/repositories/accounts'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { HubTier } from '@vynel/contracts/hub/entitlements'
import { tierMeetsMinimum } from '@vynel/contracts/hub/catalog'
import { listCatalog, getCatalogItemDetail, findCatalogItemById, findItemVersion } from '@vynel/registry'
import type { CloudAppOptions } from '../cloud-app-options.js'
import { requireAccount, type AccountVariables } from '../middleware/require-account.js'
import { artifactKey } from '../artifacts/artifact-store.js'

class TierTooLowError extends VynelError {
  readonly code = 'tier_too_low'
  readonly httpStatus = 403
}

class ArtifactMissingError extends VynelError {
  readonly code = 'artifact_missing'
  readonly httpStatus = 404
}

/** The caller's live tier, or null when there's no active account behind the
 * (validly-signed) token — a deleted/disabled account. */
async function resolveActiveCallerTier(
  db: CloudDatabase,
  accountId: string,
  now: Date,
): Promise<HubTier | null> {
  const account = await findAccountById(db, accountId)
  if (account === null || account.status !== 'active') return null
  return resolveEffectiveTier(account.tier, account.tierExpiresAt, now)
}

export function buildCatalogRoutes(options: CloudAppOptions) {
  const now = (): Date => options.now?.() ?? new Date()

  return new Hono<{ Variables: AccountVariables }>()
    .use('*', requireAccount(options.accessTokenVerifier))
    .get('/', async (c) => {
      // Browse fail-open: default to basic if the account is gone.
      const callerTier = (await resolveActiveCallerTier(options.db, c.var.account.accountId, now())) ?? 'basic'
      const items = await listCatalog(options.db, { callerTier })
      return c.json({ items })
    })
    .get('/:itemId', async (c) => {
      const callerTier = (await resolveActiveCallerTier(options.db, c.var.account.accountId, now())) ?? 'basic'
      const detail = await getCatalogItemDetail(options.db, {
        itemId: c.req.param('itemId'),
        callerTier,
      })
      return c.json(detail)
    })
    .get('/:itemId/versions/:version/download', async (c) => {
      const itemId = c.req.param('itemId')
      const version = c.req.param('version')

      // Fail-closed: an inactive/gone account may not download anything.
      const callerTier = await resolveActiveCallerTier(options.db, c.var.account.accountId, now())
      if (callerTier === null) {
        throw new TierTooLowError('This account can’t install marketplace items.')
      }
      const item = await findCatalogItemById(options.db, itemId)
      if (item === null || item.status !== 'published') {
        throw new NotFoundError('catalog item', itemId)
      }
      const minimumTier: HubTier = item.minimumTier === 'pro' ? 'pro' : 'basic'
      if (!tierMeetsMinimum(callerTier, minimumTier)) {
        throw new TierTooLowError(`Installing ${item.displayName} needs the ${minimumTier} plan.`)
      }
      const versionRow = await findItemVersion(options.db, { itemId, version })
      if (versionRow === null) throw new NotFoundError('catalog item version', `${itemId}@${version}`)

      // The sha256 is a strong ETag — a synced desktop that already has this
      // version's bytes gets a 304 instead of a re-download.
      const etag = `"${versionRow.artifactSha256}"`
      if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304 })

      const bytes = await options.artifactStore.get(artifactKey(itemId, version))
      if (bytes === null) throw new ArtifactMissingError('Artifact bytes are missing from storage.')
      // A web Response takes the Uint8Array directly (Hono's c.body typing
      // wants ArrayBuffer, which a Node Buffer view isn't).
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-length': String(bytes.length),
          etag,
          'x-artifact-sha256': versionRow.artifactSha256,
        },
      })
    })
}
