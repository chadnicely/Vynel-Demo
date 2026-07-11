// The /admin fallback surface — manual account provisioning + catalog
// publishing until real admin tooling lands. Guarded by the CLOUD_ADMIN_TOKEN
// bearer. Thin: this route only decodes the base64 transport; the publish
// use-case (size cap, sha256, byte-immutability conflict check, store put,
// version record) is `@vynel/registry`'s `publishCatalogArtifact`.

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createProvisionedAccount } from '@vynel/accounts'
import { PublishItemSchema, publishCatalogArtifact } from '@vynel/registry'
import type { CloudAppOptions } from '../cloud-app-options.js'
import { requireAdminToken } from '../middleware/require-admin.js'

const CreateAccountSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(120),
  platformUserId: z.string().min(1).max(120).optional(),
})

// Base64 inflates ~4/3; the JSON wrapper adds a little. 16MB covers the
// registry's 10MB artifact cap with headroom.
const MAX_PUBLISH_BODY_BYTES = 16 * 1024 * 1024

const PublishRequestSchema = PublishItemSchema.extend({
  // The artifact zip, base64-encoded (curated items are small — inline JSON
  // beats multipart for a v1 admin CLI).
  artifactBase64: z.string().min(1),
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
    .post(
      '/catalog/publish',
      bodyLimit({ maxSize: MAX_PUBLISH_BODY_BYTES }),
      zValidator('json', PublishRequestSchema),
      async (c) => {
        const { artifactBase64, ...item } = c.req.valid('json')
        const result = await publishCatalogArtifact(options.db, options.artifactStore, {
          ...item,
          artifactBytes: Buffer.from(artifactBase64, 'base64'),
        })
        return c.json(result, 201)
      },
    )
}
