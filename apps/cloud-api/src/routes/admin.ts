// The /admin fallback surface — manual provisioning until (and alongside)
// the platform webhooks (M3). Guarded by the CLOUD_ADMIN_TOKEN bearer.

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createProvisionedAccount } from '@vynel/accounts'
import type { CloudAppOptions } from '../cloud-app-options.js'
import { requireAdminToken } from '../middleware/require-admin.js'

const CreateAccountSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(120),
  platformUserId: z.string().min(1).max(120).optional(),
})

export function buildAdminRoutes(options: CloudAppOptions) {
  const linkDeps = {
    mail: options.mail,
    linkBaseUrl: options.linkBaseUrl,
    ...(options.now !== undefined ? { now: options.now } : {}),
  }
  return new Hono()
    .use('*', requireAdminToken(options.adminToken))
    .post('/accounts', zValidator('json', CreateAccountSchema), async (c) => {
      const body = c.req.valid('json')
      // exactOptionalPropertyTypes: spread the optional only when present.
      const { accountId } = await createProvisionedAccount(
        options.db,
        {
          email: body.email,
          displayName: body.displayName,
          ...(body.platformUserId !== undefined ? { platformUserId: body.platformUserId } : {}),
        },
        linkDeps,
      )
      return c.json({ accountId }, 201)
    })
}
