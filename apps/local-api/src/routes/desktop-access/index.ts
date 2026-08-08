// The `desktop-access` HTTP surface — USER-scoped, mounted at `/desktop/access`
// from `apps/local-api/src/app.ts`:
//
//   GET    /          -> listDesktopAppGrants (what the user has granted, per app)
//   DELETE /:appName  -> revokeDesktopAccess  (the user's revocation door)
//
// GRANTS ARE NEVER CREATED HERE. The only creation door is the
// `request_desktop_access` MCP tool, which cards in every permission mode —
// the approval card is the consent moment. These routes exist so the user can
// SEE and REVOKE what they granted (the management surface).
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses.

import { resolver, validator } from 'hono-openapi/zod'
import { NotFoundError } from '@vynel/errors'
import {
  listDesktopAppGrants,
  revokeDesktopAccess,
  type DesktopAppGrantRow,
} from '@vynel/desktop-control'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  DesktopAccessParamSchema,
  ListDesktopAccessResponseSchema,
} from './schemas.js'

function serializeGrant(grant: DesktopAppGrantRow) {
  return {
    id: grant.id,
    appName: grant.appName,
    tier: grant.tier,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  }
}

export const desktopAccessApp = factory
  .createApp()
  // GET / — every desktop app grant the user holds.
  .get(
    '/',
    describeRoute({
      tags: ['desktop-access'],
      summary: 'List the desktop apps the user has granted Claude access to.',
      'x-sdk-name': 'desktopAccess.list',
      responses: {
        200: {
          description: 'Array of desktop app grants (app + tier).',
          content: { 'application/json': { schema: resolver(ListDesktopAccessResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const grants = listDesktopAppGrants(c.var.db, c.var.user.id)
      return c.json(grants.map(serializeGrant))
    },
  )
  // DELETE /:appName — revoke a grant (normalized key match; outbox co-committed).
  .delete(
    '/:appName',
    describeRoute({
      tags: ['desktop-access'],
      summary: "Revoke Claude's access to a desktop app.",
      'x-sdk-name': 'desktopAccess.revoke',
      responses: {
        204: { description: 'Grant revoked.' },
        404: { description: 'No grant exists for that app.' },
      },
    }),
    validator('param', DesktopAccessParamSchema),
    ...userScoped,
    (c) => {
      const revoked = revokeDesktopAccess(c.var.db, {
        userId: c.var.user.id,
        appName: c.req.valid('param').appName,
        now: new Date(),
      })
      if (revoked === null) {
        throw new NotFoundError('desktop app grant', c.req.valid('param').appName)
      }
      return c.body(null, 204)
    },
  )
