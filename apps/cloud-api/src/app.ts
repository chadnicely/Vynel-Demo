// `createCloudApp` — the hub's Hono app. One `instanceof VynelError` onError
// maps typed domain errors to HTTP; routes are thin chains over the accounts
// leaf (docs/module-notes/cloud-api.md §2).

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { VynelError } from '@vynel/errors'
import type { CloudAppOptions } from './cloud-app-options.js'
import { buildAuthRoutes } from './routes/auth.js'
import { buildAdminRoutes } from './routes/admin.js'
import { buildCatalogRoutes } from './routes/catalog.js'
import { buildDesktopReleaseRoutes } from './routes/desktop-releases.js'
import { buildPlatformRoutes } from './routes/platform.js'
import { buildSetPasswordPage } from './routes/set-password-page.js'

// Hono's HTTPException statuses, spoken in the VynelError code vocabulary.
const HTTP_ERROR_CODE_BY_STATUS: Record<number, string> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
}

export function createCloudApp(options: CloudAppOptions): Hono {
  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json({ code: err.code, message: err.message }, err.httpStatus as ContentfulStatusCode)
    }
    // Hono's own typed failures — the JSON validator's "Malformed JSON in
    // request body" (400), bodyLimit (413), … — carry their status; answer
    // them on the same {code, message} contract instead of a 500.
    if (err instanceof HTTPException) {
      return c.json(
        { code: HTTP_ERROR_CODE_BY_STATUS[err.status] ?? 'http_error', message: err.message },
        err.status as ContentfulStatusCode,
      )
    }
    options.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })

  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.route('/auth', buildAuthRoutes(options))
  app.route('/admin', buildAdminRoutes(options))
  app.route('/catalog', buildCatalogRoutes(options))
  app.route('/platform', buildPlatformRoutes(options))
  app.route('/releases', buildDesktopReleaseRoutes(options))
  app.route('/set-password', buildSetPasswordPage())

  return app
}
