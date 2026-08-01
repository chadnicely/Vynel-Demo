// The marketplace catalog surface (browse + detail + download). Both reads
// require the access token; the caller's tier is looked up FRESH from the
// accounts table on every request — never the (~7-day-stale) token claim.
//
// Browse/detail are fail-OPEN (a gone account browses as basic); the download
// is fail-CLOSED (no live active account, or tier below the item's minimum →
// denied). That asymmetry is the §5 "browse generous, install gated" line —
// the gates themselves live in `@vynel/registry` (`authorizeCatalogDownload`);
// this route only resolves the caller, answers conditional requests, and
// shapes the response.

import { Hono } from 'hono'
import { resolveActiveAccountTier } from '@vynel/accounts'
import {
  listCatalog,
  getCatalogItemDetail,
  authorizeCatalogDownload,
  loadCatalogArtifact,
} from '@vynel/registry'
import type { CloudAppOptions } from '../cloud-app-options.js'
import { requireAccount, type AccountVariables } from '../middleware/require-account.js'

export function buildCatalogRoutes(options: CloudAppOptions) {
  const now = (): Date => options.now?.() ?? new Date()

  return new Hono<{ Variables: AccountVariables }>()
    .use('*', requireAccount(options.accessTokenVerifier))
    .get('/', async (c) => {
      // Browse fail-open: default to basic if the account is gone.
      const callerTier =
        (await resolveActiveAccountTier(options.db, c.var.account.accountId, now())) ?? 'basic'
      const items = await listCatalog(options.db, { callerTier })
      return c.json({ items })
    })
    .get('/:itemId', async (c) => {
      const callerTier =
        (await resolveActiveAccountTier(options.db, c.var.account.accountId, now())) ?? 'basic'
      const detail = await getCatalogItemDetail(options.db, {
        itemId: c.req.param('itemId'),
        callerTier,
      })
      return c.json(detail)
    })
    .get('/:itemId/versions/:version/download', async (c) => {
      const itemId = c.req.param('itemId')
      const version = c.req.param('version')

      // Fail-closed: null (inactive/gone account) is denied inside the gate.
      const callerTier = await resolveActiveAccountTier(options.db, c.var.account.accountId, now())
      const authorized = await authorizeCatalogDownload(options.db, { itemId, version, callerTier })

      // The sha256 is a strong ETag — a synced desktop that already has this
      // version's bytes gets a 304 instead of a re-download.
      const etag = `"${authorized.artifactSha256}"`
      if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304 })

      const bytes = await loadCatalogArtifact(options.artifactStore, { itemId, version })
      // A web Response takes the Uint8Array directly (Hono's c.body typing
      // wants ArrayBuffer, which a Node Buffer view isn't).
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-length': String(bytes.length),
          etag,
          'x-artifact-sha256': authorized.artifactSha256,
          // Absent on versions published before the hub had a signing key —
          // the desktop verifies-if-present against its pinned public key.
          ...(authorized.artifactSignature !== null
            ? { 'x-artifact-signature': authorized.artifactSignature }
            : {}),
        },
      })
    })
}
