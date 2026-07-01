// The `createApp` DI factory. Returns the Hono `app` that `server.ts` listens
// on. Wires request-scoped `c.var.{db,logger,appRequest}`, the single
// `instanceof VynelError` onError, the `/openapi.json` spec, and the mounted
// routes. (Knowledge-slice pull — more routes + the first-launch gate mount as
// their features land.)

import { Hono } from 'hono'
import { openAPISpecs } from 'hono-openapi'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import { VynelError } from '@vynel/core/errors'
import type { AppEnv } from './factory.js'
import { openApiInfo } from './openapi.js'
import { knowledgeApp } from './routes/knowledge/index.js'

export interface CreateAppOptions {
  readonly db: Database
  readonly logger: Logger
}

export function createApp(options: CreateAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // Captured at construction so handlers can re-enter via `c.var.appRequest(...)`.
  const appRequest = app.request.bind(app)

  app.use('*', async (c, next) => {
    c.set('db', options.db)
    c.set('logger', options.logger)
    c.set('appRequest', appRequest)
    await next()
  })

  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json(
        { code: err.code, message: err.message },
        err.httpStatus as ContentfulStatusCode,
      )
    }
    c.var.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })

  // OpenAPI 3.1 spec — served by hono-openapi at request time (routes mounted
  // after this still flatten correctly). Consumed by scripts/generators.
  app.get('/openapi.json', openAPISpecs(app, openApiInfo))

  app.route('/workspaces/:workspaceId/knowledge', knowledgeApp)

  return app
}
